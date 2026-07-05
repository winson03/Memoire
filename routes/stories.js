'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const router = express.Router();
const { ensureAuth } = require('../middleware/auth');
const { Books, Folders, Media, Favourites, Notifications } = require('../lib/queries');
const { THEME_KEYS } = require('../lib/themes');
const storage = require('../lib/storage');
const pdf = require('../lib/pdf');
const archiver = require('archiver');

// Media uploads stream straight to a temp file (no in-memory buffering and no
// size limit) so very large videos are bounded only by free disk space.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `up-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
});

const STATUS_DEFS = [
  { key: 'published', label: 'Published', desc: 'Visible to everyone' },
  { key: 'private', label: 'Private', desc: 'Only you can see it' },
  { key: 'draft', label: 'Draft', desc: 'Not published yet' },
];

function ownerOnly(book, req) {
  return book && req.user && book.user_id === req.user.id;
}

router.use(ensureAuth);

// ── Reader ──────────────────────────────────────────────────────────────────
router.get('/reader/:id', (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!book) return res.redirect('/dashboard');
  if (book.status !== 'published' && !ownerOnly(book, req)) return res.redirect('/dashboard');

  if (book.status === 'published' && !ownerOnly(book, req)) Books.incrementViews(book.id);

  const photos = Media.listForBook(book.id);
  // Only show other books by this author that are public (published) — or the
  // viewer's own — so private/draft stories never leak.
  const moreByAuthor = Books.listByAuthor(book.author)
    .filter((b) => b.id !== book.id && (b.status === 'published' || b.user_id === req.user.id))
    .slice(0, 3);
  const faved = Favourites.idsForUser(req.user.id).includes(book.id);

  res.render('reader', { openBook: book, photos, moreByAuthor, faved, isOwner: ownerOnly(book, req), blocks: parseBlocks(book.content) });
});

// ── Download a story as a zip (folder): its images in order + a text file ──────
router.get('/stories/:id/download', async (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!book) return res.redirect('/dashboard');
  // Same access rule as the reader: published, or your own.
  if (book.status !== 'published' && !ownerOnly(book, req)) return res.redirect('/dashboard');

  const photos = Media.listForBook(book.id).filter((m) => m.telegram_file_id);
  const safe = (book.title || 'story').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'story';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safe)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('[story download]', err.message);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  archive.pipe(res);

  // Images only — zero-padded prefix keeps them in gallery order inside the folder.
  for (let i = 0; i < photos.length; i++) {
    const m = photos[i];
    try {
      const buf = await storage.fetchBuffer(m.telegram_file_id);
      const base = m.file_name || `image-${i + 1}.jpg`;
      archive.append(buf, { name: `${String(i + 1).padStart(3, '0')}-${base}` });
    } catch (e) {
      console.error('[story download] image', m.id, e.message);
    }
  }

  archive.finalize();
});

// ── Compose: block-based story body (text + images interleaved) ───────────────
function parseBlocks(json) {
  let arr = [];
  try { arr = JSON.parse(json || '[]'); } catch (_) { arr = []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((b) => b && (b.type === 'text' || b.type === 'image'))
    .map((b) => (b.type === 'text'
      ? { type: 'text', value: String(b.value || '') }
      : { type: 'image', mediaId: parseInt(b.mediaId, 10) || null, caption: String(b.caption || '') }))
    .filter((b) => (b.type === 'text' ? b.value.trim() !== '' : b.mediaId));
}

router.get('/stories/:id/compose', (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!ownerOnly(book, req)) return res.redirect('/dashboard');
  res.render('compose', { book, blocks: parseBlocks(book.content) });
});

router.post('/stories/:id/content', (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!ownerOnly(book, req)) return res.status(403).send('Forbidden');
  Books.setContent(book.id, JSON.stringify(parseBlocks(req.body.content)));
  req.flash('info', 'Story saved.');
  res.redirect('/reader/' + book.id);
});

// ── Editor ──────────────────────────────────────────────────────────────────
router.get('/editor', (req, res) => {
  const u = req.user;
  let book;

  if (req.query.id) {
    book = Books.findById(parseInt(req.query.id, 10));
    if (!book) return res.redirect('/dashboard');
    if (!ownerOnly(book, req)) return res.redirect('/reader/' + book.id);
  } else {
    // "New story" / "New novel" — create a blank draft, then edit it.
    const type = req.query.type === 'novel' ? 'novel' : 'story';
    const folderId = req.query.folder ? parseInt(req.query.folder, 10) : null;
    const folder = folderId ? Folders.findById(folderId) : null;
    book = Books.create({
      user_id: u.id,
      title: type === 'novel' ? 'Untitled novel' : 'Untitled story',
      author: u.name,
      series: folder ? folder.name : null,
      collection: null,
      folder_id: folder && folder.user_id === u.id ? folder.id : null,
      status: 'draft',
      theme: 'terra',
      year: new Date().getFullYear(),
      blurb: '',
      type,
    });
    return res.redirect('/editor?id=' + book.id);
  }

  const photos = Media.listForBook(book.id);
  const folders = Folders.listForUser(u.id);
  // The user's other story titles — the editor confirms before saving a duplicate.
  const otherTitles = Books.listByUser(u.id).filter((b) => b.id !== book.id).map((b) => b.title);
  res.render('editor', { book, photos, folders, otherTitles, statusDefs: STATUS_DEFS, themeKeys: THEME_KEYS, blocks: parseBlocks(book.content) });
});

// ── Bulk folder import: one folder → one private story ───────────────────────
// Creates the story shell (named after the folder, private, first photo as
// cover, filed into the chosen app folder); the client then uploads the
// folder's files into it one by one.
router.post('/stories/import', (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 120) || 'Untitled story';
  const folderId = req.body.folder_id ? parseInt(req.body.folder_id, 10) : null;
  const folder = folderId ? Folders.findById(folderId) : null;
  const dest = folder && folder.user_id === req.user.id ? folder : null;
  const book = Books.create({
    user_id: req.user.id,
    title,
    author: req.user.name,
    series: dest ? dest.name : null,
    folder_id: dest ? dest.id : null,
    status: 'private',
    theme: 'terra',
    blurb: '',
    type: 'story',
  });
  Books.update(book.id, {
    title,
    status: 'private',
    theme: 'terra',
    cover_mode: 'first',
    series: dest ? dest.name : null,
    folder_id: dest ? dest.id : null,
  });
  res.json({ id: book.id });
});

// ── Create / Update story ─────────────────────────────────────────────────────
router.post('/stories/:id', (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!ownerOnly(book, req)) return res.status(403).send('Forbidden');

  // Saving honours the selected Visibility (Published / Private / Draft).
  const status = ['published', 'private', 'draft'].includes(req.body.status) ? req.body.status : book.status;

  const folderId = req.body.folder_id ? parseInt(req.body.folder_id, 10) : null;
  const folder = folderId ? Folders.findById(folderId) : null;

  Books.update(book.id, {
    title: (req.body.title || '').trim() || 'Untitled story',
    blurb: req.body.blurb || '',
    status,
    theme: THEME_KEYS.includes(req.body.theme) ? req.body.theme : book.theme,
    cover_mode: req.body.cover_mode,
    series: folder ? folder.name : (req.body.series || null),
    collection: (req.body.collection || '').trim() || null,
    folder_id: folder && folder.user_id === req.user.id ? folder.id : null,
  });

  // Novels carry their written body inline in the editor form.
  if (typeof req.body.content === 'string') {
    Books.setContent(book.id, JSON.stringify(parseBlocks(req.body.content)));
  }

  req.flash('info', { published: 'Story published.', private: 'Saved privately.', draft: 'Draft saved.' }[status] || 'Story saved.');
  res.redirect('/reader/' + book.id);
});

// ── Delete story ──────────────────────────────────────────────────────────────
router.post('/stories/:id/delete', (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!ownerOnly(book, req)) return res.status(403).send('Forbidden');
  // Remove the stored files from disk before the rows cascade away.
  Media.listForBook(book.id).forEach((m) => storage.remove(m.telegram_file_id));
  Books.remove(book.id);
  res.redirect(req.body.redirect || '/dashboard');
});

// ── Favourite toggle (form) ───────────────────────────────────────────────────
router.post('/stories/:id/favourite', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const book = Books.findById(id);
  if (book) {
    const faved = Favourites.toggle(req.user.id, id);
    if (faved) Notifications.createLike({ recipientId: book.user_id, actorId: req.user.id, bookId: id });
  }
  res.redirect(req.body.redirect || '/dashboard');
});

// ── Favourite toggle (AJAX) ───────────────────────────────────────────────────
router.post('/stories/:id/favourite-ajax', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const book = Books.findById(id);
  if (!book) return res.status(404).json({ error: 'not found' });
  const faved = Favourites.toggle(req.user.id, id);
  if (faved) Notifications.createLike({ recipientId: book.user_id, actorId: req.user.id, bookId: id });
  res.json({ faved });
});

// ── Media: upload to Telegram ─────────────────────────────────────────────────
router.post('/stories/:id/media', upload.single('file'), async (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!ownerOnly(book, req)) return res.status(403).json({ error: 'forbidden' });
  if (!req.file) return res.status(400).json({ error: 'no file' });

  try {
    const baseLabel = (req.body.label || req.file.originalname.replace(/\.[^.]+$/, '')).slice(0, 120);

    // Folder upload: name the story after the folder, but only while it still
    // has its auto-generated default title (never clobber a real title).
    const setTitle = (req.body.set_title || '').trim().slice(0, 120);
    if (setTitle && /^untitled (story|novel)$/i.test((book.title || '').trim())) {
      Books.setTitle(book.id, setTitle);
    }

    // Store one already-uploaded buffer as a Media row and return its summary.
    const addMedia = (rec, label) => {
      const media = Media.create({
        book_id: book.id,
        label,
        kind: rec.kind,
        mime: rec.mime,
        file_name: rec.file_name,
        file_size: rec.file_size,
        telegram_file_id: rec.file_id,
        telegram_unique_id: rec.unique_id,
        telegram_message_id: rec.message_id,
        position: Media.nextPosition(book.id),
      });
      return { id: media.id, kind: media.kind, label: media.label, file_name: media.file_name };
    };

    const items = [];
    const isPdf = req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname);

    if (isPdf) {
      // Render each page to a JPEG and store them as photos (1 page = 1 image).
      let pages = null;
      try {
        const buf = await fs.promises.readFile(req.file.path);
        pages = await pdf.pdfToImages(buf, { dpi: 150, maxPages: 100 });
      } catch (e) {
        console.error('[pdf convert]', e.message); // fall back to storing the PDF itself
      }
      if (pages && pages.length) {
        for (let i = 0; i < pages.length; i++) {
          const rec = await storage.uploadBuffer(pages[i], `${baseLabel}-p${i + 1}.jpg`, 'image/jpeg');
          items.push(addMedia(rec, `${baseLabel} · p${i + 1}`));
        }
      } else {
        const rec = await storage.saveFile(req.file.path, req.file.originalname, req.file.mimetype);
        items.push(addMedia(rec, baseLabel));
      }
    } else {
      const rec = await storage.saveFile(req.file.path, req.file.originalname, req.file.mimetype);
      items.push(addMedia(rec, baseLabel));
    }

    Books.touch(book.id);
    res.json({ items });
  } catch (err) {
    console.error('[media upload]', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  } finally {
    // Clean up the temp upload if it wasn't moved into the store.
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

// ── Cover image: upload a custom cover to Telegram ────────────────────────────
router.post('/stories/:id/cover', upload.single('cover'), async (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!ownerOnly(book, req)) return res.status(403).json({ error: 'forbidden' });
  if (!req.file) return res.status(400).json({ error: 'no file' });
  if (!(req.file.mimetype || '').startsWith('image/')) {
    return res.status(400).json({ error: 'Cover must be an image.' });
  }

  try {
    const tg = await storage.saveFile(req.file.path, req.file.originalname, req.file.mimetype);
    Media.removeCovers(book.id); // replace any previous cover
    const media = Media.create({
      book_id: book.id,
      label: 'Cover',
      kind: 'cover',
      mime: tg.mime,
      file_name: tg.file_name,
      file_size: tg.file_size,
      telegram_file_id: tg.file_id,
      telegram_unique_id: tg.unique_id,
      telegram_message_id: tg.message_id,
      position: -1,
    });
    Books.setCover(book.id, media.id);
    res.json({ id: media.id, url: '/media/' + media.id });
  } catch (err) {
    console.error('[cover upload]', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  } finally {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

// ── Media: stream from Telegram ───────────────────────────────────────────────
router.get('/media/:id', async (req, res) => {
  const media = Media.findById(parseInt(req.params.id, 10));
  if (!media || !media.telegram_file_id) return res.status(404).send('Not found');
  try {
    await storage.streamTo(media.telegram_file_id, res, {
      mime: media.mime,
      fileName: media.file_name,
      inline: req.query.download ? false : true,
      range: req.headers.range || null,
    });
  } catch (err) {
    console.error('[media stream]', err.message);
    if (!res.headersSent) res.status(502).send('Could not load media.');
  }
});

// ── Media: delete ─────────────────────────────────────────────────────────────
router.post('/stories/:id/media/:mediaId/delete', (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!ownerOnly(book, req)) return res.status(403).json({ error: 'forbidden' });
  const media = Media.findById(parseInt(req.params.mediaId, 10));
  if (media && media.book_id === book.id) {
    storage.remove(media.telegram_file_id);
    Media.remove(media.id);
  }
  res.json({ ok: true });
});

// ── Media: reorder ────────────────────────────────────────────────────────────
router.post('/stories/:id/media/reorder', (req, res) => {
  const book = Books.findById(parseInt(req.params.id, 10));
  if (!ownerOnly(book, req)) return res.status(403).json({ error: 'forbidden' });
  const order = Array.isArray(req.body.order) ? req.body.order.map((n) => parseInt(n, 10)).filter(Boolean) : [];
  Media.reorder(book.id, order);
  res.json({ ok: true });
});

module.exports = router;
