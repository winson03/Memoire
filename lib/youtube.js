'use strict';

// YouTube uploads for large videos.
//
// The public Telegram Bot API cannot serve back files over 20 MB, so admin
// videos above the threshold go to the admin's YouTube channel (as Unlisted)
// and are embedded in pages instead of streamed from Telegram. Media rows for
// these store `yt:<videoId>` in the telegram_file_id column with kind
// 'youtube'.
//
// Auth: reuses the app's Google OAuth client (GOOGLE_CLIENT_ID/SECRET). An
// admin connects their channel once via /settings/youtube/connect; the
// refresh token is kept in the app_settings table and exchanged for access
// tokens on demand.

const fs = require('fs');
const axios = require('axios');
const db = require('./db');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const TOKEN_KEY = 'youtube_refresh_token';

// Videos above this size skip Telegram and go to YouTube (admins only).
const thresholdBytes = Number(process.env.YOUTUBE_UPLOAD_THRESHOLD_MB || 15) * 1024 * 1024;

const getSetting = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const putSetting = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function refreshToken() {
  const row = getSetting.get(TOKEN_KEY);
  return row ? row.value : null;
}

function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function isConnected() {
  return isConfigured() && Boolean(refreshToken());
}

// Consent URL for the one-time channel connection (offline access so we get a
// refresh token; prompt=consent forces Google to reissue one on reconnect).
function authUrl(redirectUri) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

// OAuth callback: swap the code for tokens and persist the refresh token.
async function handleCallback(code, redirectUri) {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
  if (!data.refresh_token) throw new Error('Google did not return a refresh token — try disconnecting the app at myaccount.google.com/permissions and reconnecting.');
  putSetting.run(TOKEN_KEY, data.refresh_token);
}

// Access token, refreshed on demand and cached until shortly before expiry.
let cached = { token: null, exp: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const rt = refreshToken();
  if (!rt) throw new Error('YouTube is not connected — an admin must connect it in Settings.');
  try {
    const { data } = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: rt,
      grant_type: 'refresh_token',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
    cached = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
    return cached.token;
  } catch (err) {
    const desc = err.response && err.response.data && (err.response.data.error_description || err.response.data.error);
    if (desc && /invalid_grant/i.test(JSON.stringify(err.response.data))) {
      throw new Error('YouTube connection expired — reconnect it in Settings.');
    }
    throw new Error('YouTube token refresh failed: ' + (desc || err.message));
  }
}

/**
 * Upload a video file to the connected channel as Unlisted via the resumable
 * protocol (metadata first, then a streamed PUT of the bytes).
 * @returns {Promise<string>} the YouTube video id
 */
async function uploadVideo(filePath, { title, mime } = {}) {
  const token = await accessToken();
  const size = (await fs.promises.stat(filePath)).size;

  const init = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      snippet: { title: (title || 'Mémoire video').slice(0, 100), description: 'Uploaded by Mémoire.' },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Upload-Content-Type': mime || 'video/*',
        'X-Upload-Content-Length': size,
      },
      timeout: 30000,
    }
  );
  const uploadUrl = init.headers.location;
  if (!uploadUrl) throw new Error('YouTube did not return an upload URL.');

  const { data } = await axios.put(uploadUrl, fs.createReadStream(filePath), {
    headers: { 'Content-Type': mime || 'video/*', 'Content-Length': size },
    maxBodyLength: Infinity,
    timeout: 30 * 60 * 1000,
  });
  if (!data || !data.id) throw new Error('YouTube upload did not return a video id.');
  return data.id;
}

// `yt:<videoId>` ↔ videoId helpers for the storage-key column.
function keyFor(videoId) { return `yt:${videoId}`; }
function idFromKey(key) {
  const m = /^yt:([A-Za-z0-9_-]{5,})$/.exec(key || '');
  return m ? m[1] : null;
}

module.exports = { isConfigured, isConnected, authUrl, handleCallback, uploadVideo, thresholdBytes, keyFor, idFromKey };
