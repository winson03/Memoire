'use strict';

// Learn gallery items' aspect ratios from their cached 640px thumbnails (a
// header read, no decode) so the masonry grid can reserve each tile's shape
// before its image loads. Best-effort: anything that fails is simply sized by
// the browser once the image arrives.

const storage = require('./storage');
const { Gallery } = require('./queries');

async function learnSizes(images) {
  try {
    await Promise.all(images.filter((im) => !im.width && im.telegram_file_id).map(async (im) => {
      const isVideo = (im.mime || '').startsWith('video/');
      const size = await storage.thumbSize(im.telegram_file_id, 640, isVideo ? 'video' : 'photo').catch(() => null);
      if (size) { Gallery.setSize(im.id, size.width, size.height); im.width = size.width; im.height = size.height; }
    }));
  } catch (err) {
    console.warn('[media-sizes] lookup failed:', err.message);
  }
}

module.exports = { learnSizes };
