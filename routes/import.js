'use strict';

// Save from web — the /import page (paste a link, set up the extension and the
// iPhone Shortcut) and the small token-protected API those clients call.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const router = express.Router();
const db = require('../lib/db');
const { ensureAuth } = require('../middleware/auth');
const { Folders, Gallery } = require('../lib/queries');
const importer = require('../lib/importer');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const EXT_DIR = path.join(__dirname, '..', 'extension');

// ── API (extension, Shortcut, and the page itself) ─────────────────────────
// Token auth via "Authorization: Bearer <key>", or the signed-in session for
// same-site calls from the /import page. CORS is open but never sends cookies,
// so cross-site callers must hold a key.
const api = express.Router();
api.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  const m = (req.get('authorization') || '').match(/^Bearer\s+(\S+)/i);
  if (m) {
    const user = db.prepare('SELECT * FROM users WHERE import_token_hash = ?').get(sha256(m[1]));
    if (!user) return res.status(401).json({ error: 'That import key is not valid. Make a new one on the Save from web page.' });
    req.importUser = user;
    return next();
  }
  if (req.isAuthenticated && req.isAuthenticated()) { req.importUser = req.user; return next(); }
  return res.status(401).json({ error: 'Add your import key first.' });
});

api.get('/ping', (req, res) => res.json({ ok: true, name: req.importUser.name }));

api.get('/folders', (req, res) => {
  res.json({ folders: Folders.forUser.all(req.importUser.id).map((f) => ({ id: f.id, name: f.name, fav: !!f.is_fav })) });
});

const jobJson = (j) => j && ({ id: j.id, status: j.status, source: j.source, total: j.total, saved: j.saved, skipped: j.skipped, failed: j.failed, error: j.error });

// Resolve a post link on the server (X, Bluesky, Reddit, any og:image page).
api.post('/link', async (req, res) => {
  const link = String((req.body && (req.body.link || req.body.url)) || '').trim();
  // The iOS share sheet sometimes sends "text + link"; pull the link out.
  const found = link.match(/https?:\/\/\S+/);
  if (!found) return res.status(400).json({ error: 'Paste a link that starts with https://' });
  try {
    const r = await importer.resolveLink(found[0]);
    const job = importer.enqueue(req.importUser.id, { source: r.source, link: found[0], folderId: req.body.folder_id, items: r.items });
    res.json({ ok: true, count: r.items.length, source: r.source, job: jobJson(job), message: `Saving ${r.items.length} ${r.items.length === 1 ? 'item' : 'items'} from ${r.source}…` });
  } catch (e) {
    res.status(422).json({ error: e.message || 'Could not read that link.' });
  }
});

// Direct media URLs the extension already found on the page.
api.post('/urls', (req, res) => {
  const b = req.body || {};
  const items = (Array.isArray(b.items) ? b.items : (Array.isArray(b.urls) ? b.urls.map((u) => ({ url: u })) : []))
    .filter((i) => i && typeof i.url === 'string');
  if (!items.length) return res.status(400).json({ error: 'No photos or videos found.' });
  const job = importer.enqueue(req.importUser.id, { source: String(b.source || 'the web').slice(0, 40), link: b.link, folderId: b.folder_id, items });
  res.json({ ok: true, count: job.total, job: jobJson(job), message: `Saving ${job.total} ${job.total === 1 ? 'item' : 'items'}…` });
});

// Raw bytes (for files only the signed-in browser can fetch, e.g. Patreon attachments).
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `impup-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: importer.MAX_BYTES },
});
api.post('/file', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file.' });
  const mime = importer.guessMime(req.body.source_url || req.file.originalname, req.file.mimetype)
    || importer.guessMime('x.' + path.extname(req.file.originalname || '').slice(1));
  if (!mime || !(mime.startsWith('image/') || mime.startsWith('video/'))) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Photos and videos only.' });
  }
  const key = importer.sourceKey(req.body.source_url);
  if (key && Gallery.findBySource(req.importUser.id, key)) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ ok: true, skipped: true, message: 'Already saved.' });
  }
  const job = importer.enqueue(req.importUser.id, {
    source: String(req.body.source || 'the web').slice(0, 40), link: req.body.link, folderId: req.body.folder_id,
    files: [{ path: req.file.path, mime, size: req.file.size, name: req.file.originalname, key }],
  });
  res.json({ ok: true, job: jobJson(job), message: 'Saving…' });
});

api.get('/jobs/:id', (req, res) => {
  const j = importer.Imports.get(parseInt(req.params.id, 10));
  if (!j || j.user_id !== req.importUser.id) return res.status(404).json({ error: 'not found' });
  res.json({ job: jobJson(j) });
});

// Latest extension version (public, so the extension can check for updates
// before it has a key). Read fresh so a deploy is picked up immediately.
router.get('/extension-version.json', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');
  let version = null;
  try { version = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')).version; } catch (_) {}
  res.json({ version, download: '/import/extension.zip', page: '/import' });
});

router.use('/api', api);

// ── Page (signed-in only) ────────────────────────────────────────────────────
router.use(ensureAuth);

router.get('/', (req, res) => {
  const newToken = req.session.newImportToken || null;
  delete req.session.newImportToken;
  const origin = `${req.protocol}://${req.get('host')}`;
  res.render('import', {
    folders: Folders.forUser.all(req.user.id),
    recent: importer.Imports.recent(req.user.id),
    hasToken: !!req.user.import_token_hash,
    newToken,
    origin,
    extVersion: (() => { try { return JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')).version; } catch (_) { return null; } })(),
  });
});

router.get('/recent.json', (req, res) => {
  res.json({ recent: importer.Imports.recent(req.user.id).map((j) => ({ ...jobJson(j), link: j.link, folder: j.folder_name, created_at: j.created_at })) });
});

router.post('/token', (req, res) => {
  const token = 'mem_' + crypto.randomBytes(24).toString('base64url');
  db.prepare('UPDATE users SET import_token_hash = ? WHERE id = ?').run(sha256(token), req.user.id);
  req.session.newImportToken = token;
  res.redirect('/import#key');
});

router.post('/token/revoke', (req, res) => {
  db.prepare('UPDATE users SET import_token_hash = NULL WHERE id = ?').run(req.user.id);
  req.flash('info', 'Import key turned off. The extension and Shortcut stop working until you make a new one.');
  res.redirect('/import#key');
});

// The Chrome extension, zipped, with this server's address filled in.
router.get('/extension.zip', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  res.attachment('memoire-save-extension.zip');
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', (e) => { console.error('[extension zip]', e.message); res.end(); });
  zip.pipe(res);
  zip.directory(EXT_DIR, 'memoire-save', (entry) => (entry.name === 'config.js' ? false : entry));
  zip.append(`// Filled in by the server you downloaded this from.\nself.MEMOIRE_SERVER = ${JSON.stringify(origin)};\n`, { name: 'memoire-save/config.js' });
  zip.finalize();
});

module.exports = router;
