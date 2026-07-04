'use strict';

// Standalone image gallery — just images, no title/text/folder. Sorted by date,
// newest first by default; ?order=oldest flips it.

const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const router = express.Router();
const { ensureAuth } = require('../middleware/auth');
const { Gallery } = require('../lib/queries');
const storage = require('../lib/storage');
const youtube = require('../lib/youtube');

// Stream uploads to a temp file (no in-memory buffering), like the story media route.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `gup-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
});

router.use(ensureAuth);

// Gallery page.
router.get('/', (req, res) => {
  const order = req.query.order === 'oldest' ? 'oldest' : 'newest';
  const images = Gallery.listForUser(req.user.id, order);
  res.render('gallery', { images, order });
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
    // Big admin videos go to YouTube (unlisted) — Telegram can't serve back
    // files over 20 MB through the public Bot API.
    let rec;
    if (req.user.role === 'admin' && mime.startsWith('video/') && req.file.size > youtube.thresholdBytes) {
      if (!youtube.isConnected()) {
        return res.status(400).json({ error: `Videos over ${Math.round(youtube.thresholdBytes / (1024 * 1024))} MB are uploaded to YouTube — connect your channel in Settings first.` });
      }
      const title = req.file.originalname.replace(/\.[^.]+$/, '').slice(0, 100);
      const videoId = await youtube.uploadVideo(req.file.path, { title, mime });
      rec = { file_id: youtube.keyFor(videoId), unique_id: null, message_id: null, mime, file_name: req.file.originalname, file_size: req.file.size };
    } else {
      rec = await storage.saveFile(req.file.path, req.file.originalname, req.file.mimetype);
    }
    const img = Gallery.create({
      user_id: req.user.id,
      telegram_file_id: rec.file_id,
      telegram_unique_id: rec.unique_id,
      telegram_message_id: rec.message_id,
      mime: rec.mime,
      file_name: rec.file_name,
      file_size: rec.file_size,
    });
    res.json({ id: img.id, url: '/gallery/' + img.id + '/raw', mime: img.mime, youtube_id: youtube.idFromKey(img.telegram_file_id) });
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
  const ytId = youtube.idFromKey(img.telegram_file_id);
  if (ytId) return res.redirect(`https://www.youtube.com/watch?v=${ytId}`);
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
