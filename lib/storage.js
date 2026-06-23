'use strict';

// Local disk media storage.
//
// Drop-in replacement for the Telegram backend: files are written to
// data/media/ and streamed back from disk. The DB still stores an opaque key
// in the `telegram_file_id` column (now just a filename), so no schema change
// is needed. There is no external server and no 50 MB upload cap.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEDIA_DIR = path.resolve(process.cwd(), process.env.MEDIA_PATH || './data/media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Semantic kind from a mime type / filename (mirrors the old Telegram logic).
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

// Disk is always available.
function isConfigured() { return true; }
async function checkConnection() { return { connected: true }; }

// Resolve a stored key to an absolute path (basename-only, no traversal).
function resolvePath(key) {
  if (!key) return null;
  return path.join(MEDIA_DIR, path.basename(String(key)));
}

// Write a buffer to disk and return a Telegram-compatible record. `opts` is
// accepted for signature parity (e.g. asDocument) but ignored — we store the
// exact bytes regardless.
async function uploadBuffer(buffer, fileName, mime /*, opts */) {
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extOf(fileName, mime)}`;
  await fs.promises.writeFile(path.join(MEDIA_DIR, key), buffer);
  return {
    file_id: key,
    unique_id: null,
    message_id: null,
    kind: kindForMime(mime, fileName),
    mime: mime || null,
    file_name: fileName || null,
    file_size: buffer ? buffer.length : null,
  };
}

// Move an already-on-disk file (e.g. a multer temp upload) into the media
// store without buffering it in memory — so uploads are limited only by disk.
async function saveFile(srcPath, fileName, mime) {
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extOf(fileName, mime)}`;
  const dest = path.join(MEDIA_DIR, key);
  try {
    await fs.promises.rename(srcPath, dest);
  } catch (e) {
    if (e.code === 'EXDEV') { // temp dir on a different volume → copy then remove
      await fs.promises.copyFile(srcPath, dest);
      await fs.promises.unlink(srcPath).catch(() => {});
    } else { throw e; }
  }
  const size = (await fs.promises.stat(dest)).size;
  return {
    file_id: key,
    unique_id: null,
    message_id: null,
    kind: kindForMime(mime, fileName),
    mime: mime || null,
    file_name: fileName || null,
    file_size: size,
  };
}

// Stream a stored file to an Express response, with HTTP range support so
// videos can seek.
async function streamTo(key, res, { mime, fileName, inline = true } = {}) {
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

// Best-effort delete of a stored file.
function remove(key) {
  try {
    const fp = resolvePath(key);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (_) { /* ignore */ }
}

module.exports = {
  isConfigured,
  checkConnection,
  uploadBuffer,
  saveFile,
  streamTo,
  remove,
  MEDIA_DIR,
  // Optional hard cap (MB). Unset/0 = unlimited (disk-bound).
  maxFileBytes: Number(process.env.STORAGE_MAX_FILE_SIZE || 0) > 0
    ? Number(process.env.STORAGE_MAX_FILE_SIZE) * 1024 * 1024
    : Infinity,
};
