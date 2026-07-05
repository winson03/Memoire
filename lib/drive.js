'use strict';

// Google Drive media storage.
//
// Used for videos too large for Telegram's public Bot API to serve back
// (uploads are capped at 50 MB but downloads at 20 MB — see lib/telegram.js).
// The Drive API honours Range headers, so <video> seeking works like the
// other backends.
//
// Two auth modes, tried in this order:
//
// 1. OAuth (personal Google account) — the admin clicks "Connect Google
//    Drive" in Settings, which reuses the app's Google OAuth client
//    (GOOGLE_CLIENT_ID/SECRET) with the narrow drive.file scope and stores a
//    refresh token in the app_settings table (or GDRIVE_OAUTH_REFRESH_TOKEN
//    env). Files land in a "Mémoire videos" folder the app creates in that
//    account's My Drive. This is the mode for personal Gmail accounts:
//    Google removed service accounts' own storage quota, so they can no
//    longer own files in a My Drive.
//
// 2. Service account (Google Workspace only) — GDRIVE_CREDENTIALS_FILE or
//    GDRIVE_SERVICE_ACCOUNT_EMAIL + GDRIVE_PRIVATE_KEY, with GDRIVE_FOLDER_ID
//    pointing at a *shared drive* folder the service account can write to.
//    Auth is a plain RS256 JWT (Node's crypto) — no googleapis dependency.

const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const SA_SCOPE = 'https://www.googleapis.com/auth/drive';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const FOLDER_ID = (process.env.GDRIVE_FOLDER_ID || '').trim();
const OAUTH_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const OAUTH_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

// ── app_settings helpers (token + auto-created folder id live in the DB) ─────
function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function delSetting(key) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

// ── Service-account credentials (Workspace shared drives only) ───────────────
// Load from the JSON file or the env-var pair. Never throws — a misconfigured
// Drive just reports isConfigured() === false.
function loadCredentials() {
  const file = (process.env.GDRIVE_CREDENTIALS_FILE || '').trim();
  if (file) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (json.client_email && json.private_key) {
        return { email: json.client_email, key: json.private_key };
      }
    } catch (e) {
      console.error('[drive] could not read GDRIVE_CREDENTIALS_FILE:', e.message);
    }
  }
  const email = (process.env.GDRIVE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const key = (process.env.GDRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (email && key) return { email, key };
  return null;
}

const CREDS = loadCredentials();

// ── Auth mode ─────────────────────────────────────────────────────────────────
function refreshToken() {
  return (process.env.GDRIVE_OAUTH_REFRESH_TOKEN || '').trim() || getSetting('gdrive_refresh_token') || null;
}

function oauthReady() {
  return Boolean(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET && refreshToken());
}

// 'oauth' | 'service-account' | null. OAuth wins when both are present.
function authMode() {
  if (oauthReady()) return 'oauth';
  if (CREDS) return 'service-account';
  return null;
}

function isConfigured() {
  return authMode() !== null;
}

// Store the refresh token from the Settings connect flow. Also clears the
// cached access token and any folder id left over from a previous account.
function saveRefreshToken(token) {
  setSetting('gdrive_refresh_token', token);
  delSetting('gdrive_folder_id');
  cachedToken = null;
}

function disconnect() {
  delSetting('gdrive_refresh_token');
  delSetting('gdrive_folder_id');
  cachedToken = null;
}

// The DB-stored refresh token (null when it came from the env instead) — shown
// on the admin Settings page so it can be copied into hosting env vars.
function storedToken() {
  if ((process.env.GDRIVE_OAUTH_REFRESH_TOKEN || '').trim()) return null;
  return getSetting('gdrive_refresh_token');
}

// ── Access token (cached until shortly before expiry) ────────────────────────
let cachedToken = null; // { token, exp } — exp in epoch seconds

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function serviceAccountAssertion(now) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: CREDS.email,
    scope: SA_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(CREDS.key);
  return `${unsigned}.${b64url(signature)}`;
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const mode = authMode();
  if (!mode) throw new Error('Google Drive is not configured.');
  const params = mode === 'oauth'
    ? new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        refresh_token: refreshToken(),
        grant_type: 'refresh_token',
      })
    : new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: serviceAccountAssertion(now),
      });

  let data;
  try {
    ({ data } = await axios.post(TOKEN_URL, params, { timeout: 30000 }));
  } catch (err) {
    // Token endpoint errors are { error, error_description } — surface them so
    // a bad key or a revoked/expired token reads as more than "status code 400".
    const d = err.response && err.response.data;
    const detail = d && (d.error_description || d.error);
    const hint = mode === 'oauth' ? ' Reconnect Google Drive from Settings.' : '';
    throw new Error(`Google Drive auth failed${detail ? `: ${detail}` : ` (${err.message})`}.${hint}`);
  }
  cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.token;
}

// Surface Drive's JSON error message instead of a bare status code.
function driveError(err, fallback) {
  const apiMsg = err.response && err.response.data && err.response.data.error && err.response.data.error.message;
  return new Error(apiMsg ? `Google Drive: ${apiMsg}` : (err.message || fallback));
}

// ── Upload folder ─────────────────────────────────────────────────────────────
// OAuth mode: uploads go into a "Mémoire videos" folder the app creates once
// in the connected account's My Drive (the drive.file scope only lets the app
// touch files/folders it created, so it can't use a pre-existing folder).
// GDRIVE_FOLDER_ID overrides this for service-account/shared-drive setups.
async function ensureFolder(token) {
  if (FOLDER_ID) return FOLDER_ID;
  if (authMode() !== 'oauth') return null;
  const existing = getSetting('gdrive_folder_id');
  if (existing) return existing;
  const { data } = await axios.post(
    `${API}/files?fields=id&supportsAllDrives=true`,
    { name: 'Mémoire videos', mimeType: 'application/vnd.google-apps.folder' },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 30000 }
  );
  setSetting('gdrive_folder_id', data.id);
  return data.id;
}

// ── Upload (resumable: metadata first, then one PUT of the bytes) ─────────────
// Start a resumable upload session and return its URL. When `origin` is set,
// Google binds the session to that origin so a *browser* can PUT the bytes
// directly (CORS) — used for big videos that must bypass our host's
// body-size/memory limits. Session URLs are pre-authorized (no token needed).
async function createUploadSession({ fileName, mime, size, origin = null }) {
  const token = await getAccessToken();
  const metadata = { name: fileName || 'upload' };
  const parent = await ensureFolder(token);
  if (parent) metadata.parents = [parent];

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mime || 'application/octet-stream',
    'X-Upload-Content-Length': String(size),
  };
  if (origin) headers.Origin = origin;

  let session;
  try {
    session = await axios.post(
      `${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id,size`,
      metadata,
      { headers, timeout: 30000 }
    );
  } catch (err) {
    throw driveError(err, 'Drive upload could not start');
  }
  const sessionUrl = session.headers.location;
  if (!sessionUrl) throw new Error('Google Drive did not return an upload session URL.');
  return sessionUrl;
}

// Fetch a stored file's metadata (used to verify browser-direct uploads).
async function fileMeta(fileId) {
  const token = await getAccessToken();
  try {
    const { data } = await axios.get(
      `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
    );
    return data;
  } catch (err) {
    throw driveError(err, 'Drive file not found');
  }
}

// `body` may be a Buffer or a readable stream; `size` must be the byte length.
async function uploadBody(body, size, fileName, mime) {
  const sessionUrl = await createUploadSession({ fileName, mime, size });
  try {
    const { data } = await axios.put(sessionUrl, body, {
      headers: { 'Content-Type': mime || 'application/octet-stream', 'Content-Length': String(size) },
      maxBodyLength: Infinity,
      timeout: 10 * 60 * 1000,
    });
    return data; // { id, size }
  } catch (err) {
    throw driveError(err, 'Drive upload failed');
  }
}

// Record shape mirrors telegram.uploadBuffer so lib/storage.js can treat
// backends interchangeably. `kind` is filled in by the caller (storage.js).
function toRecord(file, fileName, mime, size) {
  return {
    file_id: file.id,
    unique_id: file.id,
    message_id: null,
    kind: 'video',
    mime: mime || null,
    file_name: fileName || null,
    file_size: Number(file.size) || size || null,
  };
}

async function uploadBuffer(buffer, fileName, mime) {
  const file = await uploadBody(buffer, buffer.length, fileName, mime);
  return toRecord(file, fileName, mime, buffer.length);
}

// Stream a temp upload straight from disk (no in-memory buffering).
async function saveFile(srcPath, fileName, mime) {
  const size = (await fs.promises.stat(srcPath)).size;
  const file = await uploadBody(fs.createReadStream(srcPath), size, fileName, mime);
  return toRecord(file, fileName, mime, size);
}

// ── Serve ─────────────────────────────────────────────────────────────────────
/**
 * Stream a Drive file out to an Express response, forwarding a Range header so
 * browsers get 206 Partial Content for video seeking. If the ranged request
 * fails, retries as a plain full download (same pattern as lib/telegram.js).
 */
async function streamTo(fileId, res, { mime, fileName, inline = true, range = null } = {}) {
  const token = await getAccessToken();

  if (mime) res.setHeader('Content-Type', mime);
  if (fileName) res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Accept-Ranges', 'bytes');

  const url = `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const get = (withRange) => axios.get(url, {
    responseType: 'stream',
    timeout: 10 * 60 * 1000,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(withRange && range ? { Range: range } : {}),
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  let response;
  try {
    response = await get(true);
  } catch (err) {
    if (!range) throw driveError(err, 'Drive download failed');
    try {
      response = await get(false); // retry without Range
    } catch (err2) {
      throw driveError(err2, 'Drive download failed');
    }
  }

  res.status(response.status); // 206 when the range was honoured, else 200
  if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
  if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
  return new Promise((resolve, reject) => {
    response.data.on('error', reject);
    response.data.on('end', resolve);
    response.data.pipe(res);
  });
}

// Download a stored file's bytes as a Buffer (used for zip downloads).
async function fetchBuffer(fileId) {
  const token = await getAccessToken();
  try {
    const resp = await axios.get(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10 * 60 * 1000,
    });
    return Buffer.from(resp.data);
  } catch (err) {
    throw driveError(err, 'Drive download failed');
  }
}

// Permanently delete a stored file. Errors are logged, not thrown — callers
// treat removal as best-effort (matching the Telegram/disk backends).
async function remove(fileId) {
  try {
    const token = await getAccessToken();
    await axios.delete(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });
  } catch (err) {
    console.error('[drive] delete failed:', err.message);
  }
}

// Lightweight connection probe for the storage status pills.
async function checkConnection() {
  if (!isConfigured()) return { connected: false, reason: 'not configured' };
  try {
    const token = await getAccessToken();
    const { data } = await axios.get(`${API}/about?fields=user`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    });
    return { connected: true, user: data.user && data.user.emailAddress };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

module.exports = {
  isConfigured,
  authMode,
  oauthScope: OAUTH_SCOPE,
  saveRefreshToken,
  disconnect,
  storedToken,
  createUploadSession,
  fileMeta,
  uploadBuffer,
  saveFile,
  streamTo,
  fetchBuffer,
  remove,
  checkConnection,
};
