'use strict';

// Standalone image gallery — just images, no title/text/folder. Sorted by date,
// newest first by default; ?order=oldest flips it.

const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const router = express.Router();
const { ensureAuth } = require('../middleware/auth');
const { Gallery, Collections } = require('../lib/queries');
const { FOLDER_PALETTE } = require('../lib/themes');
const storage = require('../lib/storage');

// Resolve a collection id from user input to one the user owns (or null).
function ownCollection(req, raw) {
  const id = parseInt(raw, 10);
  if (!id) return null;
  const coll = Collections.findById(id);
  return coll && coll.user_id === req.user.id ? coll : null;
}

// Stream uploads to a temp file (no in-memory buffering), like the story media route.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `gup-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
});

router.use(ensureAuth);

// Gallery page. ?collection=<id> filters to one collection ("All" otherwise).
router.get('/', (req, res) => {
  const order = req.query.order === 'oldest' ? 'oldest' : 'newest';
  const activeCollection = ownCollection(req, req.query.collection);
  const images = Gallery.listForUser(req.user.id, order, activeCollection ? activeCollection.id : null);
  res.render('gallery', {
    images,
    order,
    collections: Collections.listForUser(req.user.id),
    activeCollection,
    collectionCounts: Gallery.countsByCollection(req.user.id),
  });
});

// Create a collection, then jump straight into it.
router.post('/collections', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/gallery');
  const existing = Collections.listForUser(req.user.id);
  const theme = FOLDER_PALETTE[existing.length % FOLDER_PALETTE.length];
  const coll = Collections.create(req.user.id, name, theme);
  res.redirect('/gallery?collection=' + coll.id);
});

// Delete a collection — its media are kept and go back to "All".
router.post('/collections/:id/delete', (req, res) => {
  const coll = ownCollection(req, req.params.id);
  if (coll) Collections.remove(coll.id);
  res.redirect('/gallery');
});

// Move one media item into a collection (or none). AJAX from the tile select.
router.post('/:id/collection', (req, res) => {
  const img = Gallery.findById(parseInt(req.params.id, 10));
  if (!img || img.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
  const coll = ownCollection(req, req.body.collection_id);
  Gallery.setCollection(img.id, coll ? coll.id : null);
  res.json({ ok: true, collection_id: coll ? coll.id : null });
});

// Upload one image or video (called once per file by the client, for progress).
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const mime = req.file.mimetype || '';
  if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Images and videos only.' });
  }
  try {
    const rec = await storage.saveFile(req.file.path, req.file.originalname, req.file.mimetype);
    const coll = ownCollection(req, req.body.collection_id); // uploads land in the open collection
    const img = Gallery.create({
      user_id: req.user.id,
      telegram_file_id: rec.file_id,
      telegram_unique_id: rec.unique_id,
      telegram_message_id: rec.message_id,
      mime: rec.mime,
      file_name: rec.file_name,
      file_size: rec.file_size,
      collection_id: coll ? coll.id : null,
    });
    res.json({ id: img.id, url: '/gallery/' + img.id + '/raw', mime: img.mime });
  } catch (err) {
    console.error('[gallery upload]', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  } finally {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

// Stream an image's bytes (owner only — the gallery is private).
router.get('/:id/raw', async (req, res) => {
  const img = Gallery.findById(parseInt(req.params.id, 10));
  if (!img || img.user_id !== req.user.id || !img.telegram_file_id) return res.status(404).send('Not found');
  try {
    await storage.streamTo(img.telegram_file_id, res, { mime: img.mime, fileName: img.file_name, inline: !req.query.download, range: req.headers.range || null });
  } catch (err) {
    console.error('[gallery stream]', err.message);
    if (!res.headersSent) res.status(502).send('Could not load image.');
  }
});

// Delete an image (owner only).
router.post('/:id/delete', (req, res) => {
  const img = Gallery.findById(parseInt(req.params.id, 10));
  if (img && img.user_id === req.user.id) {
    storage.remove(img.telegram_file_id);
    Gallery.remove(img.id);
  }
  res.json({ ok: true });
});

module.exports = router;
