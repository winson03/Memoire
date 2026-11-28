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
  status        TEXT NOT NULL DEFAULT 'private', -- 'published' | 'private'
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
// "Draft" is gone: a story you started and closed without saving was landing
// there by accident, which is what "private" already means. Anything still
// marked draft becomes private. Idempotent — it's a no-op once converted.
db.exec("UPDATE books SET status = 'private' WHERE status = 'draft'");

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
// Favourite folders sit first; position is the user's drag-and-drop order.
if (!folderCols.includes('is_fav')) db.exec('ALTER TABLE folders ADD COLUMN is_fav INTEGER NOT NULL DEFAULT 0');
if (!folderCols.includes('position')) db.exec('ALTER TABLE folders ADD COLUMN position INTEGER');

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
// Pixel size (of the 640px thumbnail — only the ratio matters) so the masonry
// grid can reserve each tile's shape before its image loads. Filled lazily.
if (!galleryCols.includes('width')) db.exec('ALTER TABLE gallery_images ADD COLUMN width INTEGER');
if (!galleryCols.includes('height')) db.exec('ALTER TABLE gallery_images ADD COLUMN height INTEGER');

// Small key-value store for app-level state (e.g. the Google Drive OAuth
// refresh token saved by the Settings "Connect Google Drive" flow).
db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// ── Folders hold everything (2026-11) ────────────────────────────────────────
// A folder now holds a memory's stories AND its photos/videos. Gallery media get
// a folder_id; every gallery collection is folded into the folder with the same
// name (case-insensitive), or a new folder of that name. Runs once (flagged in
// app_settings). The old collection rows and gallery_images.collection_id are
// left untouched, and collections.folder_id records where each one went, so the
// merge can be inspected or undone.
const galleryCols2 = db.prepare('PRAGMA table_info(gallery_images)').all().map((c) => c.name);
if (!galleryCols2.includes('folder_id')) db.exec('ALTER TABLE gallery_images ADD COLUMN folder_id INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_gallery_folder ON gallery_images(folder_id)');
const collCols = db.prepare('PRAGMA table_info(collections)').all().map((c) => c.name);
if (!collCols.includes('folder_id')) db.exec('ALTER TABLE collections ADD COLUMN folder_id INTEGER');

const MERGE_FLAG = 'merge_collections_into_folders_v1';
if (!db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(MERGE_FLAG)) {
  db.transaction(() => {
    const colls = db.prepare('SELECT * FROM collections ORDER BY id').all();
    const findFolder = db.prepare('SELECT id FROM folders WHERE user_id = ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1');
    const makeFolder = db.prepare('INSERT INTO folders (user_id, name, theme) VALUES (?, ?, ?)');
    const linkColl = db.prepare('UPDATE collections SET folder_id = ? WHERE id = ?');
    const moveMedia = db.prepare('UPDATE gallery_images SET folder_id = ? WHERE collection_id = ? AND folder_id IS NULL');
    let made = 0; let moved = 0;
    colls.forEach((c) => {
      let fid = c.folder_id;
      if (!fid) {
        const hit = findFolder.get(c.user_id, c.name);
        if (hit) fid = hit.id;
        else { fid = makeFolder.run(c.user_id, c.name, c.theme || 'terra').lastInsertRowid; made += 1; }
        linkColl.run(fid, c.id);
      }
      moved += moveMedia.run(fid, c.id).changes;
    });
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(MERGE_FLAG, new Date().toISOString());
    console.log(`[migrate] collections → folders: ${colls.length} collections, ${made} new folders, ${moved} media moved`);
  })();
}

// One-time: video-only stories left on the default "Colour theme" cover get the
// "first photo/video" cover instead, so they show a frame from their first
// video. Stories with photos keep whatever cover they had.
const VIDEO_COVER_FLAG = 'video_only_stories_first_cover_v1';
if (!db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(VIDEO_COVER_FLAG)) {
  db.transaction(() => {
    const n = db.prepare(`
      UPDATE books SET cover_mode = 'first'
      WHERE cover_mode = 'theme'
        AND EXISTS (SELECT 1 FROM media m WHERE m.book_id = books.id AND m.kind = 'video')
        AND NOT EXISTS (SELECT 1 FROM media m WHERE m.book_id = books.id AND m.kind = 'photo')
    `).run().changes;
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(VIDEO_COVER_FLAG, new Date().toISOString());
    console.log(`[migrate] video-only stories → first-frame cover: ${n}`);
  })();
}

// ── Save from web (2026-11) ──────────────────────────────────────────────────
// Photos/videos pulled in from X, Patreon and other sites by the browser
// extension, the "paste a link" box or the phone Shortcut. source_url (origin +
// path of the original media file) stops the same file being saved twice.
const galleryCols3 = db.prepare('PRAGMA table_info(gallery_images)').all().map((c) => c.name);
if (!galleryCols3.includes('source_url')) db.exec('ALTER TABLE gallery_images ADD COLUMN source_url TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_gallery_source ON gallery_images(user_id, source_url)');
// Personal import token (sha256 hash only) for the extension and Shortcut.
const userCols2 = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols2.includes('import_token_hash')) db.exec('ALTER TABLE users ADD COLUMN import_token_hash TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS imports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  source     TEXT,
  link       TEXT,
  folder_id  INTEGER,
  status     TEXT NOT NULL DEFAULT 'pending',
  total      INTEGER NOT NULL DEFAULT 0,
  saved      INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_imports_user ON imports(user_id, id);
`);
// Jobs that were mid-way when the server restarted won't resume.
db.prepare("UPDATE imports SET status = 'error', error = 'Interrupted by a server restart — try again.' WHERE status IN ('pending','running')").run();

module.exports = db;
