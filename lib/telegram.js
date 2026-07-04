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
const image = require('./image');

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
    // Too-big uploads come back as HTTP 413 (often with no JSON body) or a
    // "too big/large" description. Surface a clear, actionable message instead
    // of a raw status code, and mark it isApi so we don't pointlessly retry.
    const status = err.response && err.response.status;
    const desc = err.response && err.response.data && err.response.data.description;
    if (status === 413 || (desc && /too big|too large|entity too large/i.test(desc))) {
      const e = new Error('This file is too large for Telegram storage (the Bot API accepts up to 50 MB). Please use a smaller/compressed file.');
      e.isApi = true; e.tooLarge = true; throw e;
    }
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

  // Shrink oversized images so they stay under Telegram's 20 MB download cap —
  // otherwise a big photo uploads but can never be served back. No-op for
  // normal-sized images, videos, and PDFs.
  ({ buffer, mime, fileName } = await image.shrinkIfLarge(buffer, mime, fileName));

  // asDocument: store the exact bytes (no Telegram photo recompression) while
  // keeping the semantic kind (e.g. 'photo' for avatars).
  let primary = opts.asDocument
    ? { method: 'sendDocument', field: 'document', kind: methodForMime(mime, fileName).kind }
    : methodForMime(mime, fileName);

  // sendPhoto rejects photos over 10 MB, so a big image would pay for a full
  // upload, get refused, then upload again as a document. Skip straight to
  // the document path (which also keeps the original bytes uncompressed).
  const PHOTO_BYTE_LIMIT = 9.5 * 1024 * 1024;
  if (primary.method === 'sendPhoto' && buffer.length > PHOTO_BYTE_LIMIT) {
    primary = { method: 'sendDocument', field: 'document', kind: 'photo' };
  }

  let result, field = primary.field, kind = primary.kind;
  try {
    result = await withFallback((ep) => sendOnce(ep, primary.method, primary.field, buffer, fileName, mime));
  } catch (err) {
    // A too-big file will fail identically as a document (same 50 MB cap), so
    // don't waste a second upload — surface the clear message right away.
    if (err.tooLarge || primary.method === 'sendDocument') throw err;
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

// Map a local Bot API file_path to a readable on-disk path. When the Bot API
// server runs in a container, getFile returns a container path (e.g.
// /var/lib/telegram-bot-api/...) that must be rewritten to the host-mounted
// data dir before Node can read it. Tries the translated path first, then the
// raw path (covers the in-container case). Returns the first that exists, else
// null so the caller falls back to an HTTP download.
function localDiskPath(filePath) {
  if (!filePath) return null;
  const cp = (process.env.TELEGRAM_BOT_API_CONTAINER_PATH || '').replace(/\/+$/, '');
  const dp = (process.env.TELEGRAM_BOT_API_DATA_PATH || '').replace(/\/+$/, '');
  const candidates = [];
  if (cp && dp && filePath.startsWith(cp)) candidates.push(dp + filePath.slice(cp.length));
  candidates.push(filePath);
  return candidates.find((p) => (p.startsWith('/') || /^[A-Za-z]:\\/.test(p)) && fs.existsSync(p)) || null;
}

/**
 * Stream a stored file out to an Express response.
 * On a local Bot API server, getFile returns an absolute path we read from disk
 * (translating container→host paths as needed). Otherwise we proxy the download.
 * Honours a Range request header (`range`) so <video>/<audio> can seek and play
 * — browsers (Safari/iOS especially) require 206 Partial Content for video.
 */
async function streamTo(fileId, res, { mime, fileName, inline = true, range = null } = {}) {
  const { ep, filePath } = await resolveFile(fileId);

  if (mime) res.setHeader('Content-Type', mime);
  if (fileName) res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Accept-Ranges', 'bytes');

  // Local server: read the file straight off disk (any size, no 20 MB Bot API
  // download cap), resolving the container→host path first.
  const diskPath = ep.local ? localDiskPath(filePath) : null;
  if (diskPath) {
    const total = fs.statSync(diskPath).size;
    let start = 0;
    let end = total - 1;
    const m = range && /^bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end >= total) end = total - 1;
      if (start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`);
        return void res.end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    }
    res.setHeader('Content-Length', end - start + 1);
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(diskPath, { start, end });
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
  }

  // Proxy the download, forwarding the Range header so the file server can
  // answer with 206 + Content-Range; we mirror whatever status it returns.
  const downloadUrl = `${ep.base}/file/bot${TOKEN}/${filePath}`;
  const response = await axios.get(downloadUrl, {
    responseType: 'stream',
    timeout: 10 * 60 * 1000,
    headers: range ? { Range: range } : {},
    validateStatus: (s) => s >= 200 && s < 400,
  });
  res.status(response.status); // 206 when the range was honoured, else 200
  if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
  if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
  return new Promise((resolve, reject) => {
    response.data.on('error', reject);
    response.data.on('end', resolve);
    response.data.pipe(res);
  });
}

// Download a stored file's bytes as a Buffer (used by the disk migration).
async function fetchBuffer(fileId) {
  const { ep, filePath } = await resolveFile(fileId);
  const disk = localDiskPath(filePath);
  if (disk) return fs.promises.readFile(disk);
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
