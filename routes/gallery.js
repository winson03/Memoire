'use strict';

// Standalone image gallery — just images, no title/text/folder. Sorted by date,
// newest first by default; ?order=oldest flips it.

const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const archiver = require('archiver');
const router = express.Router();
const { ensureAuth } = require('../middleware/auth');
const { Gallery, Collections, Notifications } = require('../lib/queries');
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
// ?assign=1 (with a collection) enters bulk-assign mode: show ALL images so the
// user can multi-select which ones belong to the collection.
router.get('/', (req, res) => {
  const order = req.query.order === 'oldest' ? 'oldest' : 'newest';
  const activeCollection = ownCollection(req, req.query.collection);
  const assignMode = !!(req.query.assign && activeCollection);
  // The Favourites tab shows only favourited images (not while assigning/in a collection).
  const favMode = !assignMode && !activeCollection && !!req.query.favourites;
  const listCollectionId = assignMode ? null : (activeCollection ? activeCollection.id : null);
  const images = favMode
    ? Gallery.listFavourites(req.user.id, order)
    : Gallery.listForUser(req.user.id, order, listCollectionId);
  res.render('gallery', {
    images,
    order,
    collections: Collections.listForUser(req.user.id),
    activeCollection,
    collectionCounts: Gallery.countsByCollection(req.user.id),
    favMode,
    favCount: Gallery.favouriteCount(req.user.id),
    assignMode,
  });
});

// Toggle an image's favourite flag (owner only). AJAX from the tile heart.
router.post('/:id/favourite', (req, res) => {
  const img = Gallery.findById(parseInt(req.params.id, 10));
  if (!img || img.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
  const favourite = Gallery.toggleFavourite(img.id);
  res.json({ ok: true, favourite });
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

// Bulk-set a collection's membership from the in-page multi-select. The posted
// ids become the full membership: newly-selected images are added, and images
// that were in the collection but got deselected go back to "All".
router.post('/collections/:id/assign', (req, res) => {
  const coll = ownCollection(req, req.params.id);
  if (!coll) return res.status(404).json({ error: 'not found' });
  const ids = Array.isArray(req.body && req.body.ids)
    ? req.body.ids.map((x) => parseInt(x, 10)).filter(Boolean)
    : [];
  const selected = new Set(ids);
  const current = Gallery.listForUser(req.user.id, 'newest', coll.id).map((i) => i.id);
  const currentSet = new Set(current);

  // Add newly-selected images the user owns that aren't already in the collection.
  selected.forEach((id) => {
    if (!currentSet.has(id)) {
      const img = Gallery.findById(id);
      if (img && img.user_id === req.user.id) Gallery.setCollection(id, coll.id);
    }
  });
  // Remove images that were in the collection but are no longer selected.
  current.forEach((id) => { if (!selected.has(id)) Gallery.setCollection(id, null); });

  res.json({ ok: true });
});

// Bulk move selected media into a collection (or out, when collection_id is
// empty). Used by the "Add to collection" action in bulk-select mode.
router.post('/move', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids)
    ? req.body.ids.map((x) => parseInt(x, 10)).filter(Boolean)
    : [];
  const coll = ownCollection(req, req.body && req.body.collection_id);
  const target = coll ? coll.id : null;
  ids.forEach((id) => {
    const img = Gallery.findById(id);
    if (img && img.user_id === req.user.id) Gallery.setCollection(id, target);
  });
  res.json({ ok: true, collection_id: target });
});

// Bulk delete selected media (owner only).
router.post('/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids)
    ? req.body.ids.map((x) => parseInt(x, 10)).filter(Boolean)
    : [];
  const deleted = [];
  ids.forEach((id) => {
    const img = Gallery.findById(id);
    if (img && img.user_id === req.user.id) {
      storage.remove(img.telegram_file_id);
      Gallery.remove(img.id);
      deleted.push(id);
    }
  });
  res.json({ ok: true, deleted });
});

// Bulk download selected media as a zip. Posted via a form (repeated `ids`
// fields) so the browser handles the download natively — no JS buffering.
router.post('/bulk-download', async (req, res) => {
  const raw = req.body && req.body.ids;
  const ids = (Array.isArray(raw) ? raw : [raw]).map((x) => parseInt(x, 10)).filter(Boolean);
  const imgs = ids
    .map((id) => Gallery.findById(id))
    .filter((m) => m && m.user_id === req.user.id && m.telegram_file_id);
  if (!imgs.length) return res.redirect('/gallery');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="gallery-${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('[gallery bulk-download]', err.message);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  archive.pipe(res);
  // One buffer at a time (the loop awaits) keeps peak memory to a single file.
  for (let i = 0; i < imgs.length; i++) {
    const m = imgs[i];
    try {
      const buf = await storage.fetchBuffer(m.telegram_file_id);
      const base = m.file_name || `media-${i + 1}`;
      archive.append(buf, { name: `${String(i + 1).padStart(3, '0')}-${base}` });
    } catch (e) {
      console.error('[gallery bulk-download] item', m.id, e.message);
    }
  }
  archive.finalize();
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

// Register a video the browser uploaded straight to Google Drive (big files
// bypass this server — see POST /drive/upload-session). Verifies the file
// really exists in Drive before creating the row.
router.post('/register-drive', async (req, res) => {
  const driveId = String((req.body && req.body.drive_id) || '').trim();
  if (!driveId) return res.status(400).json({ error: 'Missing drive_id.' });
  try {
    const drive = require('../lib/drive');
    const meta = await drive.fileMeta(driveId);
    const mime = req.body.mime || meta.mimeType || '';
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
      return res.status(400).json({ error: 'Images and videos only.' });
    }
    const coll = ownCollection(req, req.body.collection_id);
    const img = Gallery.create({
      user_id: req.user.id,
      telegram_file_id: storage.driveKey(meta.id),
      telegram_unique_id: meta.id,
      telegram_message_id: null,
      mime,
      file_name: req.body.file_name || meta.name || null,
      file_size: Number(meta.size) || null,
      collection_id: coll ? coll.id : null,
    });
    res.json({ id: img.id, url: '/gallery/' + img.id + '/raw', mime: img.mime });
  } catch (err) {
    console.error('[gallery register-drive]', err.message);
    res.status(502).json({ error: 'Could not register the upload: ' + err.message });
  }
});

// Record a "batch upload finished" bell notification for gallery uploads.
router.post('/notify-complete', (req, res) => {
  const count = Math.max(0, parseInt(req.body && req.body.count, 10) || 0);
  if (!count) return res.json({ ok: true });
  const message = `${count} ${count === 1 ? 'photo' : 'photos'} added to your gallery`;
  Notifications.create({ user_id: req.user.id, type: 'upload', book_id: null, message });
  res.json({ ok: true, notification: { message, href: '/gallery' } });
});

// Stream an image's bytes (owner only — the gallery is private).
router.get('/:id/raw', async (req, res) => {
  const img = Gallery.findById(parseInt(req.params.id, 10));
  if (!img || img.user_id !== req.user.id || !img.telegram_file_id) return res.status(404).send('Not found');
  // Grid tiles request a small preview with ?w=<px>; only images are shrunk.
  const w = parseInt(req.query.w, 10);
  if (w && (img.mime || '').startsWith('image/')) {
    try {
      return await storage.streamThumb(img.telegram_file_id, w, res);
    } catch (err) {
      if (res.headersSent) return;
      console.error('[gallery thumb]', err.message);
    }
  }
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
