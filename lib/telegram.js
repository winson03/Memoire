'use strict';

// Telegram-backed media storage.
//
// Files are uploaded to a private Telegram chat/channel; Telegram returns a
// permanent `file_id` which we store in SQLite. On read, we resolve the file_id
// to a download URL (or a local path, when a self-hosted Bot API server is used)
// and stream the bytes back to the browser. Telegram is the blob store; SQLite
// only holds metadata.
//
// Endpoints are tried in order with automatic fallback: the configured
// (typically self-hosted, 2 GB-capable) server first, then the public
// api.telegram.org. If the local server is down, uploads up to 50 MB still work.

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const LOCAL = String(process.env.TELEGRAM_BOT_API_LOCAL || '').toLowerCase() === 'true';

const PUBLIC_ROOT = 'https://api.telegram.org/bot';
const NETWORK_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ERR_NETWORK']);

// Ordered list of { apiRoot, fileBase, local } endpoints to try.
function endpoints() {
  const list = [];
  const configured = (process.env.TELEGRAM_BOT_API_URL || '').trim().replace(/\/+$/, '');
  if (configured) {
    list.push({ root: configured, base: configured.replace(/\/bot$/, ''), local: LOCAL });
  }
  if (!configured || configured !== PUBLIC_ROOT) {
    // Public fallback is never "local" (file_path is relative, download by URL).
    list.push({ root: PUBLIC_ROOT, base: 'https://api.telegram.org', local: false });
  }
  return list;
}

function isConfigured() {
  return Boolean(TOKEN && CHAT_ID);
}

function isNetworkError(err) {
  return NETWORK_ERRORS.has(err.code) || /ECONNREFUSED|ENOTFOUND|socket hang up|Network Error/i.test(err.message || '');
}

// Run `fn(endpoint)` against each endpoint, falling through only on network
// errors. A real API error (e.g. 400) is thrown immediately.
async function withFallback(fn) {
  const eps = endpoints();
  let lastErr;
  for (const ep of eps) {
    try {
      return await fn(ep);
    } catch (err) {
      lastErr = err;
      if (isNetworkError(err)) continue; // local server down → try next
      throw err;                         // genuine API error → surface it
    }
  }
  throw new Error('Telegram unreachable: ' + (lastErr ? (lastErr.code || lastErr.message || 'network error') : 'no endpoints'));
}

// Choose the right Telegram send method + field for a mime type.
function methodForMime(mime = '', fileName = '') {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/') && !m.includes('gif')) return { method: 'sendPhoto', field: 'photo', kind: 'photo' };
  if (m.startsWith('video/')) return { method: 'sendVideo', field: 'video', kind: 'video' };
  if (m === 'application/pdf' || /\.pdf$/i.test(fileName)) return { method: 'sendDocument', field: 'document', kind: 'pdf' };
  return { method: 'sendDocument', field: 'document', kind: 'document' };
}

// Pull the stored file object out of a sendX response (shape varies by method).
function extractFile(result, field) {
  if (field === 'photo') {
    const sizes = result.photo || [];
    return sizes[sizes.length - 1] || {};
  }
  return result[field] || {};
}

// Send a buffer with one method/field to one endpoint.
async function sendOnce(ep, method, field, buffer, fileName, mime) {
  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append(field, buffer, { filename: fileName || 'upload', contentType: mime || 'application/octet-stream' });
  if (field !== 'document') form.append('disable_notification', 'true');

  try {
    const { data } = await axios.post(`${ep.root}${TOKEN}/${method}`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 10 * 60 * 1000,
    });
    if (!data.ok) { const e = new Error(data.description || 'Telegram error'); e.isApi = true; throw e; }
    return data.result;
  } catch (err) {
    const desc = err.response && err.response.data && err.response.data.description;
    if (desc) { const e = new Error(desc); e.isApi = true; throw e; }
    throw err; // network error (no message) — let withFallback handle it
  }
}

/**
 * Upload a buffer to Telegram. Tries the type-appropriate method first
 * (sendPhoto/sendVideo) and falls back to sendDocument for files Telegram
 * can't process inline. Each method is attempted across all endpoints.
 * @returns {Promise<{file_id, unique_id, message_id, kind, mime, file_name, file_size}>}
 */
async function uploadBuffer(buffer, fileName, mime, opts = {}) {
  if (!isConfigured()) {
    throw new Error('Telegram is not configured (missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).');
  }
  // asDocument: store the exact bytes (no Telegram photo recompression) while
  // keeping the semantic kind (e.g. 'photo' for avatars).
  const primary = opts.asDocument
    ? { method: 'sendDocument', field: 'document', kind: methodForMime(mime, fileName).kind }
    : methodForMime(mime, fileName);

  let result, field = primary.field, kind = primary.kind;
  try {
    result = await withFallback((ep) => sendOnce(ep, primary.method, primary.field, buffer, fileName, mime));
  } catch (err) {
    if (primary.method === 'sendDocument') throw err;
    // Telegram couldn't process the photo/video → store raw as a document.
    result = await withFallback((ep) => sendOnce(ep, 'sendDocument', 'document', buffer, fileName, mime));
    field = 'document';
  }

  const file = extractFile(result, field);
  return {
    file_id: file.file_id,
    unique_id: file.file_unique_id || null,
    message_id: result.message_id,
    kind,
    mime: mime || null,
    file_name: fileName || null,
    file_size: file.file_size || (buffer ? buffer.length : null),
  };
}

// Resolve a file_id to a file_path via getFile, returning which endpoint answered.
async function resolveFile(fileId) {
  return withFallback(async (ep) => {
    const { data } = await axios.get(`${ep.root}${TOKEN}/getFile`, { params: { file_id: fileId }, timeout: 30000 });
    if (!data.ok) { const e = new Error(data.description || 'getFile failed'); e.isApi = true; throw e; }
    return { ep, filePath: data.result.file_path };
  });
}

/**
 * Stream a stored file out to an Express response.
 * On a local Bot API server, getFile returns an absolute path we read from disk.
 * Otherwise we proxy the download from the file URL.
 */
async function streamTo(fileId, res, { mime, fileName, inline = true } = {}) {
  const { ep, filePath } = await resolveFile(fileId);

  if (mime) res.setHeader('Content-Type', mime);
  if (fileName) res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');

  // Local server: file_path may be an absolute on-disk path.
  if (ep.local && filePath && (filePath.startsWith('/') || /^[A-Za-z]:\\/.test(filePath)) && fs.existsSync(filePath)) {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
  }

  const downloadUrl = `${ep.base}/file/bot${TOKEN}/${filePath}`;
  const response = await axios.get(downloadUrl, { responseType: 'stream', timeout: 10 * 60 * 1000 });
  return new Promise((resolve, reject) => {
    response.data.on('error', reject);
    response.data.on('end', resolve);
    response.data.pipe(res);
  });
}

// Download a stored file's bytes as a Buffer (used by the disk migration).
// In --local mode getFile returns a path *inside the container*; translate it
// to the host-mounted volume so we can read it directly.
async function fetchBuffer(fileId) {
  const { ep, filePath } = await resolveFile(fileId);
  let local = filePath;
  const cp = (process.env.TELEGRAM_BOT_API_CONTAINER_PATH || '').replace(/\/+$/, '');
  const dp = (process.env.TELEGRAM_BOT_API_DATA_PATH || '').replace(/\/+$/, '');
  if (cp && dp && local && local.startsWith(cp)) local = dp + local.slice(cp.length);
  if (local && (local.startsWith('/') || /^[A-Za-z]:\\/.test(local)) && fs.existsSync(local)) {
    return fs.promises.readFile(local);
  }
  const url = `${ep.base}/file/bot${TOKEN}/${filePath}`;
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 10 * 60 * 1000 });
  return Buffer.from(resp.data);
}

// Lightweight connection probe for the storage status pills.
async function checkConnection() {
  if (!isConfigured()) return { connected: false, reason: 'not configured' };
  try {
    const data = await withFallback(async (ep) => {
      const r = await axios.get(`${ep.root}${TOKEN}/getMe`, { timeout: 8000 });
      return r.data;
    });
    return { connected: !!data.ok, username: data.ok ? data.result.username : null };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

module.exports = {
  isConfigured,
  uploadBuffer,
  streamTo,
  fetchBuffer,
  checkConnection,
  maxFileBytes: (Number(process.env.TELEGRAM_MAX_FILE_SIZE || 50)) * 1024 * 1024,
};
