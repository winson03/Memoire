'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || './data/memoire.db';
const resolved = path.resolve(process.cwd(), DB_PATH);

// Ensure the data directory exists.
fs.mkdirSync(path.dirname(resolved), { recursive: true });

const db = new Database(resolved);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id       TEXT UNIQUE,
  email           TEXT UNIQUE,
  username        TEXT,
  password_hash   TEXT,
  name            TEXT NOT NULL,
  handle          TEXT,
  initials        TEXT,
  bio             TEXT,
  role            TEXT NOT NULL DEFAULT 'storyteller',  -- 'storyteller' | 'admin'
  is_guest        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A collection is a "big folder" that groups several folders together.
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  theme       TEXT NOT NULL DEFAULT 'terra',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  theme         TEXT NOT NULL DEFAULT 'terra',
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS books (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL,
  series      TEXT,
  collection  TEXT,
  folder_id   INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft',   -- 'published' | 'private' | 'draft'
  theme         TEXT NOT NULL DEFAULT 'terra',
  cover_mode    TEXT NOT NULL DEFAULT 'theme',    -- 'theme' | 'upload' | 'first'
  cover_media_id INTEGER,                         -- uploaded cover (media row, kind='cover')
  year        INTEGER,
  views       INTEGER NOT NULL DEFAULT 0,
  blurb       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id             INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  label               TEXT,
  kind                TEXT NOT NULL DEFAULT 'photo',   -- 'photo' | 'video' | 'pdf' | 'document'
  mime                TEXT,
  file_name           TEXT,
  file_size           INTEGER,
  telegram_file_id    TEXT,
  telegram_unique_id  TEXT,
  telegram_message_id INTEGER,
  position            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favourites (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- recipient
  type        TEXT NOT NULL,                                            -- 'like' | 'birthday'
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,          -- who triggered it
  book_id     INTEGER REFERENCES books(id) ON DELETE CASCADE,           -- related story
  message     TEXT,                                                     -- prebuilt text (optional)
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS views_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_books_user   ON books(user_id);
CREATE INDEX IF NOT EXISTS idx_books_folder ON books(folder_id);
CREATE INDEX IF NOT EXISTS idx_media_book   ON media(book_id);
CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_views_when   ON views_log(viewed_at);
`);

// ── Migrations for databases created before username/password existed ─────────
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
if (!userCols.includes('password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
if (!userCols.includes('phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
if (!userCols.includes('dob')) db.exec('ALTER TABLE users ADD COLUMN dob TEXT');
if (!userCols.includes('avatar_file_id')) db.exec('ALTER TABLE users ADD COLUMN avatar_file_id TEXT');
if (!userCols.includes('avatar_mime')) db.exec('ALTER TABLE users ADD COLUMN avatar_mime TEXT');
if (!userCols.includes('reset_token')) db.exec('ALTER TABLE users ADD COLUMN reset_token TEXT');
if (!userCols.includes('reset_expires')) db.exec('ALTER TABLE users ADD COLUMN reset_expires TEXT');
// Case-insensitive uniqueness for usernames (partial index allows multiple NULLs).
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE) WHERE username IS NOT NULL');

const bookCols = db.prepare('PRAGMA table_info(books)').all().map((c) => c.name);
if (!bookCols.includes('cover_mode')) db.exec("ALTER TABLE books ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'theme'");
if (!bookCols.includes('cover_media_id')) db.exec('ALTER TABLE books ADD COLUMN cover_media_id INTEGER');
if (!bookCols.includes('is_saved')) {
  // 0 = freshly created stub (never explicitly saved), 1 = saved at least once.
  db.exec('ALTER TABLE books ADD COLUMN is_saved INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE books SET is_saved = 1'); // pre-existing stories count as saved
}
if (!bookCols.includes('published_at')) {
  // Timestamp of first publish — powers the admin publish chart.
  db.exec('ALTER TABLE books ADD COLUMN published_at TEXT');
  db.exec("UPDATE books SET published_at = created_at WHERE status = 'published' AND published_at IS NULL");
}
// Ordered story body: JSON array of blocks [{type:'text',value} | {type:'image',mediaId,caption}].
if (!bookCols.includes('content')) db.exec('ALTER TABLE books ADD COLUMN content TEXT');
// 'story' (cover + photo/film gallery) | 'novel' (written body via the composer).
if (!bookCols.includes('type')) db.exec("ALTER TABLE books ADD COLUMN type TEXT NOT NULL DEFAULT 'story'");

// Alternate endings — one story told to two (or more) conclusions. The parent
// book is the story itself and owns the first ending's media; each child book
// is another ending. Children are hidden from every listing (library, folders,
// discover) and are reached through the parent's reader tabs. Nesting is one
// level only: a child can never itself be a parent.
if (!bookCols.includes('parent_book_id')) db.exec('ALTER TABLE books ADD COLUMN parent_book_id INTEGER REFERENCES books(id) ON DELETE CASCADE');
// Tab name for this ending ("Dead body", "She survives"). Set on the parent too
// — the parent is the first tab. Blank falls back to "Ending 1", "Ending 2"…
if (!bookCols.includes('ending_label')) db.exec('ALTER TABLE books ADD COLUMN ending_label TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_books_parent ON books(parent_book_id)');

// When a favourite (like) was added — powers the daily likes report.
const favCols = db.prepare('PRAGMA table_info(favourites)').all().map((c) => c.name);
if (!favCols.includes('created_at')) db.exec('ALTER TABLE favourites ADD COLUMN created_at TEXT');

const folderCols = db.prepare('PRAGMA table_info(folders)').all().map((c) => c.name);
if (!folderCols.includes('collection_id')) db.exec('ALTER TABLE folders ADD COLUMN collection_id INTEGER');

// Standalone image gallery — bare images with no title/text/folder, just a date.
db.exec(`
CREATE TABLE IF NOT EXISTS gallery_images (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_file_id    TEXT,
  telegram_unique_id  TEXT,
  telegram_message_id INTEGER,
  mime                TEXT,
  file_name           TEXT,
  file_size           INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gallery_user ON gallery_images(user_id);
`);

// Gallery collections — gallery media can be filed into a collection (reuses
// the collections table; the old folder-grouping use of it is disabled).
const galleryCols = db.prepare('PRAGMA table_info(gallery_images)').all().map((c) => c.name);
if (!galleryCols.includes('collection_id')) db.exec('ALTER TABLE gallery_images ADD COLUMN collection_id INTEGER');
// Owner can favourite a gallery image (private, per-owner — a boolean flag).
if (!galleryCols.includes('is_favourite')) db.exec('ALTER TABLE gallery_images ADD COLUMN is_favourite INTEGER NOT NULL DEFAULT 0');

// Small key-value store for app-level state (e.g. the Google Drive OAuth
// refresh token saved by the Settings "Connect Google Drive" flow).
db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

module.exports = db;
