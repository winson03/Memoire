'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');

const { passport } = require('./lib/passport');
const storage = require('./lib/storage');
const themes = require('./lib/themes');
const { locals } = require('./middleware/auth');

const app = express();

// ── View engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets.
app.use(express.static(path.join(__dirname, 'public')));

// Body parsers.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions.
app.use(session({
  secret: process.env.SESSION_SECRET || 'memoire-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 },
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
app.locals.avatarUrl = viewHelpers.avatarUrl;
app.locals.formatDob = viewHelpers.formatDob;

// Per-request locals.
app.use((req, res, next) => {
  res.locals.storageConnected = storage.isConfigured();
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
app.use('/collections', require('./routes/collections'));
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

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`\n  Mémoire is running → http://localhost:${PORT}`);
  console.log(`  Media storage:    local disk (${storage.MEDIA_DIR})`);
  console.log(`  Google sign-in:   ${require('./lib/passport').hasGoogle ? 'enabled' : 'disabled'}\n`);
});

module.exports = app;
