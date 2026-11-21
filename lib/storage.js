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
const image = require('./image');

const USE_TELEGRAM = telegram.isConfigured();

const DRIVE_PREFIX = 'gdrive:';
const DRIVE_VIDEO_MIN_BYTES = Number(process.env.GDRIVE_VIDEO_MIN_MB || 15) * 1024 * 1024;

const MEDIA_DIR = path.resolve(process.cwd(), process.env.MEDIA_PATH || './data/media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// On-disk cache of small grid thumbnails, keyed by original key + width.
// Regenerating one means pulling the full original back out of Telegram/Drive
// into memory, so on hosts with an ephemeral disk (e.g. Render) point THUMB_PATH
// at a mounted persistent disk — otherwise every redeploy wipes the cache and the
// next editor page re-fetches every original at once. Defaults under MEDIA_DIR.
// Without THUMB_PATH, thumbs go next to the SQLite database (DATABASE_PATH),
// which on Render already lives on the persistent disk; MEDIA_PATH, if set,
// keeps its old meaning.
const THUMB_DIR = process.env.THUMB_PATH
  ? path.resolve(process.cwd(), process.env.THUMB_PATH)
  : process.env.MEDIA_PATH
    ? path.join(MEDIA_DIR, 'thumbs')
    : path.join(path.dirname(path.resolve(process.cwd(), process.env.DATABASE_PATH || './data/memoire.db')), 'thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });

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
  res.setHeader('Cache-Control', 'private, max-age=2592000, immutable'); // keys are immutable — cache 30 days
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

function useDriveFor(mime, fileName, size, opts = {}) {
  if (!drive.isConfigured()) return false;
  // opts.preferDrive forces Drive regardless of kind/size — used for the JPEGs
  // rendered from an uploaded PDF, which we keep off Telegram. Falls back to the
  // default backend when Drive isn't connected.
  if (opts.preferDrive) return true;
  return kindForMime(mime, fileName) === 'video' && size > DRIVE_VIDEO_MIN_BYTES;
}

async function uploadBuffer(buffer, fileName, mime, opts = {}) {
  if (buffer && useDriveFor(mime, fileName, buffer.length, opts)) {
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

// Cap how many thumbnails are generated at once. Each generation pulls the full
// original into memory (from Telegram/Drive) before shrinking it, and sharp only
// serialises the decode — not the fetch. So without this an editor page with N
// photos would fetch N full-size originals into RAM simultaneously and OOM a
// small instance. Default 2; override with THUMBNAIL_CONCURRENCY.
const THUMB_CONCURRENCY = Math.max(1, Number(process.env.THUMBNAIL_CONCURRENCY) || 2);
let thumbActive = 0;
const thumbWaiters = [];
function acquireThumbSlot() {
  if (thumbActive < THUMB_CONCURRENCY) { thumbActive += 1; return Promise.resolve(); }
  return new Promise((resolve) => thumbWaiters.push(resolve));
}
function releaseThumbSlot() {
  const next = thumbWaiters.shift();
  if (next) next();            // hand the slot straight to the next waiter
  else thumbActive -= 1;
}

// Collapses duplicate concurrent requests for the same thumbnail (fp -> Promise)
// so an image shown twice on a page fetches its original once, not twice.
const thumbInFlight = new Map();

function thumbFile(key, w, kind) {
  const tag = kind === 'video' ? `${key}|poster|${w}` : `${key}|${w}`;
  return path.join(THUMB_DIR, crypto.createHash('sha1').update(tag).digest('hex') + '.jpg');
}
function cached(fp) {
  try { return fs.statSync(fp).size > 0; } catch (_) { return false; }
}
function clampWidth(width) {
  return Math.max(64, Math.min(2000, parseInt(width, 10) || 480));
}

// Drive videos whose preview isn't ready yet: remember the miss briefly so a
// grid of them doesn't ask Drive again on every page view (key -> expiry ms).
const posterMiss = new Map();
const POSTER_MISS_MS = 10 * 60 * 1000;

// Generate (once) and cache a small JPEG for a media key, returning its file
// path. Later calls hit the on-disk cache. Sources, cheapest first:
//   1. `source` — a local file path or Buffer we already hold (upload time);
//   2. Google Drive's own pre-rendered preview (a few KB, no original download);
//   3. photos only: the full original, fetched into memory and shrunk.
// For videos (kind 'video') this is a poster frame; only 1 and 2 apply, since
// there's no video decoder on the server. Throws when no source works —
// callers fall back to the full file (photos) or a 404 (video posters).
async function thumbnailPath(key, width, { kind = 'photo', source = null } = {}) {
  const w = clampWidth(width);
  const fp = thumbFile(key, w, kind);
  if (cached(fp)) return fp;

  const pending = thumbInFlight.get(fp);
  if (pending) return pending;

  const job = (async () => {
    if (source && kind !== 'video') {
      await fs.promises.writeFile(fp, await image.thumbnail(source, w));
      return fp;
    }

    if (isDriveKey(key)) {
      const miss = posterMiss.get(key);
      if (!(kind === 'video' && miss && miss > Date.now())) {
        let preview = null;
        try { preview = await drive.fetchThumbnail(key.slice(DRIVE_PREFIX.length), w); }
        catch (err) { console.error('[thumb] drive preview:', err.message); }
        if (preview) {
          posterMiss.delete(key);
          await fs.promises.writeFile(fp, await image.thumbnail(preview, w));
          return fp;
        }
        if (kind === 'video') posterMiss.set(key, Date.now() + POSTER_MISS_MS);
      }
    }
    if (kind === 'video') throw new Error('no poster available');

    // Last resort: pull the full original into memory. Bounded by the slot
    // limit so a page of N photos can't hold N originals in RAM at once.
    await acquireThumbSlot();
    try {
      if (cached(fp)) return fp; // produced while we queued for a slot
      const src = await fetchBuffer(key);
      await fs.promises.writeFile(fp, await image.thumbnail(src, w));
      return fp;
    } finally {
      releaseThumbSlot();
    }
  })();
  thumbInFlight.set(fp, job);
  try { return await job; } finally { thumbInFlight.delete(fp); }
}

// Stream a cached thumbnail (or video poster) to the response (long-lived
// cache — a given key+width never changes). Header/stream only start after the
// file is ready, so a failure here can be caught by the caller.
async function streamThumb(key, width, res, opts = {}) {
  const fp = await thumbnailPath(key, width, opts);
  const stat = fs.statSync(fp);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=2592000'); // 30 days
  res.setHeader('Content-Length', stat.size);
  return new Promise((resolve, reject) => {
    const s = fs.createReadStream(fp);
    s.on('error', reject); s.on('end', resolve); s.pipe(res);
  });
}

// ── Pre-generating thumbnails right after upload ─────────────────────────────
// The sizes pages actually request: 640 for grid tiles, 1080 for the reader's
// full-width images, 800 for cover backgrounds. Making them at upload time
// means viewing a story never has to touch the original.
const WARM_WIDTHS = { photo: [640, 1080], cover: [640, 800], video: [640] };

async function warmThumbs(key, kind, { source = null, widths = null } = {}) {
  const k = kind === 'video' ? 'video' : 'photo';
  const list = widths || WARM_WIDTHS[kind] || WARM_WIDTHS[k];
  let ok = true;
  for (const w of list) {
    try { await thumbnailPath(key, w, { kind: k, source }); }
    catch (err) { ok = false; if (k !== 'video') console.error('[thumb warm]', err.message); }
  }
  return ok;
}

// True when every size of this item is already on disk (no work needed).
function hasThumbs(key, kind, widths = null) {
  const k = kind === 'video' ? 'video' : 'photo';
  const list = widths || WARM_WIDTHS[kind] || WARM_WIDTHS[k];
  return list.every((w) => cached(thumbFile(key, clampWidth(w), k)));
}

// Background queue, one job at a time so warming never competes with page
// views for memory. Drive needs a moment after upload to render its preview
// (videos longer), so a miss is retried a few times with growing delays.
// In-memory only: anything lost to a restart is simply made on first view.
const WARM_RETRY_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
const warmQueue = [];
let warmRunning = false;

function queueWarm(key, kind, opts = {}, attempt = 0) {
  if (!key || !(kind === 'photo' || kind === 'video' || kind === 'cover')) return;
  warmQueue.push({ key, kind, opts, attempt });
  if (!warmRunning) runWarmQueue();
}

async function runWarmQueue() {
  warmRunning = true;
  while (warmQueue.length) {
    const { key, kind, opts, attempt } = warmQueue.shift();
    const ok = await warmThumbs(key, kind, opts).catch(() => false);
    if (!ok && isDriveKey(key) && attempt < WARM_RETRY_MS.length) {
      if (kind === 'video') posterMiss.delete(key); // let the retry ask Drive again
      const { source, ...rest } = opts; // never keep a big buffer alive for a retry
      setTimeout(() => queueWarm(key, kind, rest, attempt + 1), WARM_RETRY_MS[attempt]).unref();
    }
  }
  warmRunning = false;
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
  streamThumb,
  warmThumbs,
  hasThumbs,
  queueWarm,
  fetchBuffer,
  remove,
  MEDIA_DIR,
  THUMB_DIR,
  backend: USE_TELEGRAM ? 'telegram' : 'disk',
  // Browser-direct Drive uploads (big videos bypass this server entirely).
  driveEnabled: () => drive.isConfigured(),
  driveVideoMinBytes: DRIVE_VIDEO_MIN_BYTES,
  driveKey: (fileId) => DRIVE_PREFIX + fileId,
};
