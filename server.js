'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const flash = require('connect-flash');

const db = require('./lib/db');
const { passport } = require('./lib/passport');
const { seedAdmin } = require('./lib/seed-admin');
const storage = require('./lib/storage');
const themes = require('./lib/themes');
const { locals } = require('./middleware/auth');

const app = express();
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Security ─────────────────────────────────────────────────────────────────
// Behind a reverse proxy (nginx/Render/Railway) the proxy terminates HTTPS;
// trusting it lets secure cookies and per-IP rate limits see the real client.
if (IS_PROD) app.set('trust proxy', 1);

// Security headers. The CSP mirrors what the views actually load: same-origin
// everything, inline <script>/<style>, Google Fonts, and Google profile photos.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      // Browser-direct uploads PUT the bytes to a Google resumable-upload
      // session URL (www./storage.googleapis.com); allow those XHR targets.
      connectSrc: ["'self'", 'https://*.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      // Only force-upgrade http→https in production; on a plain-HTTP LAN
      // address this directive would break every asset request.
      ...(IS_PROD ? {} : { upgradeInsecureRequests: null }),
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  hsts: IS_PROD,
}));

// gzip/brotli text responses (HTML/CSS/JS/JSON). The built-in filter skips
// already-compressed media (images/video), so streaming/range stays untouched.
app.use(compression());

// ── View engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets.
app.use(express.static(path.join(__dirname, 'public')));

// Broad per-IP rate limit (mounted after static so assets don't count).
const { globalLimiter } = require('./middleware/rate-limit');
app.use(globalLimiter);

// Body parsers. File uploads go through multer with its own size limits, so
// these only need to fit forms and story text.
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// Sessions. Login lasts SESSION_MAX_AGE_DAYS from sign-in (default 365 = one
// year). Sessions are persisted in SQLite, so they survive server restarts.
const SESSION_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS) || 365;
if (IS_PROD && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production — refusing to start with the built-in dev secret.');
  process.exit(1);
}
app.use(session({
  store: new SqliteStore({
    client: db,
    expired: { clear: true, intervalMs: 1000 * 60 * 60 * 12 }, // sweep expired rows twice a day
  }),
  secret: process.env.SESSION_SECRET || 'memoire-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 1000 * 60 * 60 * 24 * SESSION_DAYS },
}));

// Auth + flash.
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// ── Shared view locals ─────────────────────────────────────────────────────────
// Static design helpers (used by views/partials).
app.locals.themeGradient = themes.themeGradient;
app.locals.statusColor = themes.statusColor;
app.locals.statusLabel = themes.statusLabel;
app.locals.metaRight = themes.metaRight;
app.locals.readersTxt = themes.readersTxt;
app.locals.relativeTime = themes.relativeTime;
app.locals.themeKeys = themes.THEME_KEYS;
const viewHelpers = require('./lib/view-helpers');
// Cache-busting asset version from file mtime (busts whenever the file changes).
const fs = require('fs');
app.locals.assetVer = (rel) => {
  try { return Math.floor(fs.statSync(path.join(__dirname, 'public', rel)).mtimeMs); }
  catch (_) { return Date.now(); }
};
app.locals.coverBackground = viewHelpers.coverBackground;
app.locals.coverIsImage = viewHelpers.coverIsImage;
app.locals.coverImageId = viewHelpers.coverImageId;
app.locals.pageNumbers = viewHelpers.pageNumbers;
app.locals.avatarUrl = viewHelpers.avatarUrl;
app.locals.formatDob = viewHelpers.formatDob;

// Per-request locals.
app.use((req, res, next) => {
  res.locals.storageConnected = storage.isConfigured();
  // Browser-direct Drive uploads for big videos (checked per request — the
  // admin can connect/disconnect Drive at runtime via Settings).
  res.locals.driveDirect = storage.driveEnabled();
  res.locals.driveMinBytes = storage.driveVideoMinBytes;
  res.locals.flash = [
    ...req.flash('error').map((m) => ({ type: 'error', message: m })),
    ...req.flash('info').map((m) => ({ type: 'info', message: m })),
  ];
  next();
});
app.use(locals);

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/public'));
app.use('/', require('./routes/app'));
app.use('/folders', require('./routes/folders'));
app.use('/gallery', require('./routes/gallery'));
// Collections feature disabled — router unmounted (see routes/collections.js).
// app.use('/collections', require('./routes/collections'));
app.use('/', require('./routes/stories'));

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404);
  if (req.accepts('html')) return res.send('<p style="font-family:Georgia,serif;padding:60px;text-align:center;">Page not found. <a href="/">← Home</a></p>');
  res.json({ error: 'not found' });
});

// ── Error handler ───────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large (max ${process.env.STORAGE_MAX_FILE_SIZE || 2048} MB).` });
  }
  res.status(500);
  if (req.accepts('html')) return res.send('<p style="font-family:Georgia,serif;padding:60px;text-align:center;">Something went wrong. <a href="/">← Home</a></p>');
  res.json({ error: 'server error' });
});

// Ensure an admin exists (driven by ADMIN_* env vars; safe to run every boot).
try { seedAdmin(); } catch (e) { console.error('[seed-admin]', e.message); }

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`\n  Mémoire is running → http://localhost:${PORT}`);
  console.log(`  Media storage:    ${storage.backend === 'telegram' ? 'Telegram' : `local disk (${storage.MEDIA_DIR})`}`);
  console.log(`  Google sign-in:   ${require('./lib/passport').hasGoogle ? 'enabled' : 'disabled'}\n`);

  // Daily DB backup to Telegram, at 00:00 Asia/Kuala_Lumpur (backupDatabase()
  // no-ops if Telegram isn't configured). KL is a fixed UTC+8 with no DST, so
  // a plain 24h interval stays aligned to midnight once the first run lands there.
  const { backupDatabase } = require('./lib/backup');
  const DAY_MS = 24 * 60 * 60 * 1000;
  const KL_OFFSET_MS = 8 * 60 * 60 * 1000;
  const shiftedNow = Date.now() + KL_OFFSET_MS;
  const msUntilNextMidnightKL = (Math.floor(shiftedNow / DAY_MS) + 1) * DAY_MS - shiftedNow;
  setTimeout(function runBackup() {
    backupDatabase().catch((err) => console.error('[backup] failed:', err.message));
    setInterval(() => backupDatabase().catch((err) => console.error('[backup] failed:', err.message)), DAY_MS);
  }, msUntilNextMidnightKL);
});

module.exports = app;
