'use strict';

const sharp = require('sharp');

// Telegram's Bot API can upload files up to 50 MB but only serves them back
// (getFile/download) up to 20 MB on the public API. A raw 30 MB photo therefore
// uploads fine yet can never be displayed. To guarantee every image is
// retrievable, we re-encode oversized images to a high-quality JPEG that stays
// comfortably under the download cap. Normal-sized images pass through
// untouched. Videos/PDFs/other files are never touched here.
const SHRINKABLE = /^image\/(jpe?g|png|webp|tiff?|avif|heic|heif)$/i;
const MAX_BYTES = 15 * 1024 * 1024; // stay well under Telegram's 20 MB download cap
const MAX_DIM = 5000;               // more than enough for viewing; trims giant originals

// Returns { buffer, mime, fileName } — shrunk when needed, else the originals.
async function shrinkIfLarge(buffer, mime, fileName) {
  if (!SHRINKABLE.test(mime || '')) return { buffer, mime, fileName };

  let meta;
  try { meta = await sharp(buffer).metadata(); } catch (_) { return { buffer, mime, fileName }; }

  const tooBig = buffer.length > MAX_BYTES;
  const tooWide = (meta.width || 0) > MAX_DIM || (meta.height || 0) > MAX_DIM;
  if (!tooBig && !tooWide) return { buffer, mime, fileName };

  const render = (quality) => sharp(buffer, { failOn: 'none' })
    .rotate() // bake in EXIF orientation before we drop the metadata
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  let out = await render(85);
  // If a very detailed image is still over the cap, step the quality down.
  for (let q = 75; out.length > MAX_BYTES && q >= 55; q -= 10) {
    out = await render(q);
  }

  const newName = (fileName || 'image').replace(/\.[^.]+$/, '') + '.jpg';
  return { buffer: out, mime: 'image/jpeg', fileName: newName };
}

module.exports = { shrinkIfLarge };
