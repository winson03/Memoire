'use strict';

// Media storage facade.
//
// Uses Telegram as the blob store when it is configured (TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID present); otherwise falls back to local disk (data/media/).
// On hosts with an ephemeral disk (e.g. Render's free tier) Telegram is the
// only backend that survives redeploys, so it is preferred automatically.
//
// Videos larger than GDRIVE_VIDEO_MIN_MB (default 15 MB) are stored on Google
// Drive instead when it is configured (see lib/drive.js) — the public Telegram
// Bot API accepts 50 MB uploads but refuses to serve files back over 20 MB.
//
// The DB stores an opaque key in the `telegram_file_id` column either way —
// a Telegram file_id, a local filename, or `gdrive:<id>` for Google Drive —
// so no schema change is needed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const telegram = require('./telegram');
const drive = require('./drive');

const USE_TELEGRAM = telegram.isConfigured();

const DRIVE_PREFIX = 'gdrive:';
const DRIVE_VIDEO_MIN_BYTES = Number(process.env.GDRIVE_VIDEO_MIN_MB || 15) * 1024 * 1024;

const MEDIA_DIR = path.resolve(process.cwd(), process.env.MEDIA_PATH || './data/media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Semantic kind from a mime type / filename.
function kindForMime(mime = '', fileName = '') {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/') && !m.includes('gif')) return 'photo';
  if (m.startsWith('video/')) return 'video';
  if (m === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'pdf';
  return 'document';
}

function extOf(fileName = '', mime = '') {
  const e = path.extname(fileName || '');
  if (e && e.length <= 12) return e.toLowerCase();
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('png')) return '.png';
  if (m.includes('gif')) return '.gif';
  if (m.includes('webp')) return '.webp';
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('mp4')) return '.mp4';
  if (m.includes('quicktime')) return '.mov';
  return '';
}

// ── Local disk backend ───────────────────────────────────────────────────────
function resolvePath(key) {
  if (!key) return null;
  return path.join(MEDIA_DIR, path.basename(String(key)));
}

async function diskUploadBuffer(buffer, fileName, mime) {
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extOf(fileName, mime)}`;
  await fs.promises.writeFile(path.join(MEDIA_DIR, key), buffer);
  return {
    file_id: key, unique_id: null, message_id: null,
    kind: kindForMime(mime, fileName), mime: mime || null,
    file_name: fileName || null, file_size: buffer ? buffer.length : null,
  };
}

async function diskSaveFile(srcPath, fileName, mime) {
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extOf(fileName, mime)}`;
  const dest = path.join(MEDIA_DIR, key);
  try {
    await fs.promises.rename(srcPath, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      await fs.promises.copyFile(srcPath, dest);
      await fs.promises.unlink(srcPath).catch(() => {});
    } else { throw e; }
  }
  const size = (await fs.promises.stat(dest)).size;
  return {
    file_id: key, unique_id: null, message_id: null,
    kind: kindForMime(mime, fileName), mime: mime || null,
    file_name: fileName || null, file_size: size,
  };
}

async function diskStreamTo(key, res, { mime, fileName, inline = true } = {}) {
  const fp = resolvePath(key);
  if (!fp || !fs.existsSync(fp)) { const e = new Error('file not found'); e.code = 'ENOENT'; throw e; }

  if (mime) res.setHeader('Content-Type', mime);
  if (fileName) res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Accept-Ranges', 'bytes');

  const stat = fs.statSync(fp);
  const range = res.req && res.req.headers && res.req.headers.range;
  if (range) {
    const mt = /bytes=(\d*)-(\d*)/.exec(range) || [];
    let start = mt[1] ? parseInt(mt[1], 10) : 0;
    let end = mt[2] ? parseInt(mt[2], 10) : stat.size - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= stat.size) end = stat.size - 1;
    if (start > end) { start = 0; end = stat.size - 1; }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    return new Promise((resolve, reject) => {
      const s = fs.createReadStream(fp, { start, end });
      s.on('error', reject); s.on('end', resolve); s.pipe(res);
    });
  }

  res.setHeader('Content-Length', stat.size);
  return new Promise((resolve, reject) => {
    const s = fs.createReadStream(fp);
    s.on('error', reject); s.on('end', resolve); s.pipe(res);
  });
}

function diskRemove(key) {
  try {
    const fp = resolvePath(key);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (_) { /* ignore */ }
}

// ── Telegram backend shims (telegram.js lacks saveFile/remove) ────────────────
// saveFile: stream the temp upload from disk (buffering a large video in
// memory would OOM a small host). The caller cleans up its own temp file.
function tgSaveFile(srcPath, fileName, mime) {
  return telegram.uploadFile(srcPath, fileName, mime);
}

// Telegram has no reliable per-file delete (we don't persist message_id), so
// removal is a no-op — the DB row is gone; the blob just lingers in the channel.
function tgRemove() { /* no-op */ }

// Read a stored file's bytes back into a Buffer (used for zip downloads).
async function diskFetchBuffer(key) {
  const fp = resolvePath(key);
  if (!fp || !fs.existsSync(fp)) { const e = new Error('file not found'); e.code = 'ENOENT'; throw e; }
  return fs.promises.readFile(fp);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
const backend = USE_TELEGRAM
  ? {
      isConfigured: telegram.isConfigured,
      checkConnection: telegram.checkConnection,
      uploadBuffer: telegram.uploadBuffer,
      saveFile: tgSaveFile,
      streamTo: telegram.streamTo,
      fetchBuffer: telegram.fetchBuffer,
      remove: tgRemove,
      maxFileBytes: telegram.maxFileBytes,
    }
  : {
      isConfigured: () => true,
      checkConnection: async () => ({ connected: true }),
      uploadBuffer: diskUploadBuffer,
      saveFile: diskSaveFile,
      streamTo: diskStreamTo,
      fetchBuffer: diskFetchBuffer,
      remove: diskRemove,
      maxFileBytes: Number(process.env.STORAGE_MAX_FILE_SIZE || 0) > 0
        ? Number(process.env.STORAGE_MAX_FILE_SIZE) * 1024 * 1024
        : Infinity,
    };

// ── Google Drive routing (videos too big for Telegram to serve back) ─────────
// The public Bot API accepts 50 MB uploads but refuses downloads over 20 MB,
// so large videos go to Drive when it is configured. Drive keys are stored
// with a `gdrive:` prefix in the same opaque-key column.
function isDriveKey(key) {
  return typeof key === 'string' && key.startsWith(DRIVE_PREFIX);
}

function useDriveFor(mime, fileName, size) {
  return drive.isConfigured()
    && kindForMime(mime, fileName) === 'video'
    && size > DRIVE_VIDEO_MIN_BYTES;
}

async function uploadBuffer(buffer, fileName, mime, opts) {
  if (buffer && useDriveFor(mime, fileName, buffer.length)) {
    const rec = await drive.uploadBuffer(buffer, fileName, mime);
    return { ...rec, file_id: DRIVE_PREFIX + rec.file_id, kind: kindForMime(mime, fileName) };
  }
  return backend.uploadBuffer(buffer, fileName, mime, opts);
}

async function saveFile(srcPath, fileName, mime) {
  const size = (await fs.promises.stat(srcPath)).size;
  if (useDriveFor(mime, fileName, size)) {
    const rec = await drive.saveFile(srcPath, fileName, mime);
    return { ...rec, file_id: DRIVE_PREFIX + rec.file_id, kind: kindForMime(mime, fileName) };
  }
  return backend.saveFile(srcPath, fileName, mime);
}

async function streamTo(key, res, opts) {
  if (isDriveKey(key)) return drive.streamTo(key.slice(DRIVE_PREFIX.length), res, opts);
  return backend.streamTo(key, res, opts);
}

async function fetchBuffer(key) {
  if (isDriveKey(key)) return drive.fetchBuffer(key.slice(DRIVE_PREFIX.length));
  return backend.fetchBuffer(key);
}

function remove(key) {
  if (isDriveKey(key)) {
    drive.remove(key.slice(DRIVE_PREFIX.length)); // best-effort; logs its own errors
    return;
  }
  return backend.remove(key);
}

console.log(`[storage] backend: ${USE_TELEGRAM ? 'telegram' : 'local disk'}${drive.isConfigured() ? ` + google drive (videos > ${Math.round(DRIVE_VIDEO_MIN_BYTES / 1024 / 1024)} MB)` : ''}`);

module.exports = {
  ...backend,
  uploadBuffer,
  saveFile,
  streamTo,
  fetchBuffer,
  remove,
  MEDIA_DIR,
  backend: USE_TELEGRAM ? 'telegram' : 'disk',
  // Browser-direct Drive uploads (big videos bypass this server entirely).
  driveEnabled: () => drive.isConfigured(),
  driveVideoMinBytes: DRIVE_VIDEO_MIN_BYTES,
  driveKey: (fileId) => DRIVE_PREFIX + fileId,
};
