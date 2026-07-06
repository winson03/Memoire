'use strict';

const sharp = require('sharp');

// Keep memory low on small instances (e.g. Render): don't retain decoded
// images between operations, and use a single libvips thread.
sharp.cache(false);
sharp.concurrency(1);

// Telegram's Bot API can upload files up to 50 MB but only serves them back
// (getFile/download) up to 20 MB on the public API. A raw 30 MB photo therefore
// uploads fine yet can never be displayed. To guarantee every image is
// retrievable, we re-encode oversized images to a high-quality JPEG that stays
// comfortably under the download cap. Normal-sized images pass through
// untouched. Videos/PDFs/other files are never touched here.
const SHRINKABLE = /^image\/(jpe?g|png|webp|tiff?|avif|heic|heif)$/i;
const MAX_BYTES = 15 * 1024 * 1024;      // stay well under Telegram's 20 MB download cap
const MAX_DIM = 5000;                    // more than enough for viewing; trims giant originals
const MAX_INPUT_PIXELS = 300 * 1000000;  // refuse absurd inputs (300 MP) rather than OOM

// Decoding a large image is memory-heavy, so serialise the actual sharp work:
// with several uploads in flight at once, processing them one at a time keeps
// peak memory to a single image instead of N (which was OOMing the instance).
let queue = Promise.resolve();
function withLock(fn) {
  const result = queue.then(fn);
  queue = result.then(() => {}, () => {}); // never let a failure break the chain
  return result;
}

// Returns { buffer, mime, fileName } — shrunk when needed, else the originals.
async function shrinkIfLarge(buffer, mime, fileName) {
  if (!SHRINKABLE.test(mime || '')) return { buffer, mime, fileName };

  let meta;
  try { meta = await sharp(buffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).metadata(); }
  catch (_) { return { buffer, mime, fileName }; } // unreadable/huge — leave as-is

  const tooBig = buffer.length > MAX_BYTES;
  const tooWide = (meta.width || 0) > MAX_DIM || (meta.height || 0) > MAX_DIM;
  if (!tooBig && !tooWide) return { buffer, mime, fileName };

  const render = (quality) => sharp(buffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // bake in EXIF orientation before we drop the metadata
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  return withLock(async () => {
    let out = await render(85);
    // If a very detailed image is still over the cap, step the quality down.
    for (let q = 75; out.length > MAX_BYTES && q >= 55; q -= 10) {
      out = await render(q);
    }
    const newName = (fileName || 'image').replace(/\.[^.]+$/, '') + '.jpg';
    return { buffer: out, mime: 'image/jpeg', fileName: newName };
  });
}

// Shrink an image to a small preview for grid tiles. `width` caps the long
// edge; the original is never enlarged. Progressive JPEG so it paints sharp
// quickly. Throws on non-images — callers fall back to serving the original.
async function thumbnail(buffer, width) {
  const w = Math.max(64, Math.min(2000, parseInt(width, 10) || 480));
  return withLock(() => sharp(buffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // honour EXIF orientation before metadata is dropped
    .resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true, progressive: true })
    .toBuffer());
}

module.exports = { shrinkIfLarge, thumbnail };
