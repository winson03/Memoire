'use strict';

const db = require('./db');

// ── Users ───────────────────────────────────────────────────────────────────
const Users = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byGoogleId: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  byUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),

  findById(id) { return this.byId.get(id); },
  findByGoogleId(gid) { return this.byGoogleId.get(gid); },
  findByEmail(email) { return this.byEmail.get(email); },
  findByUsername(username) { return username ? this.byUsername.get(username) : undefined; },

  create({ google_id = null, email = null, username = null, password_hash = null, name, handle = null, initials = null, bio = null, role = 'storyteller', is_guest = 0 }) {
    const info = db.prepare(`
      INSERT INTO users (google_id, email, username, password_hash, name, handle, initials, bio, role, is_guest)
      VALUES (@google_id, @email, @username, @password_hash, @name, @handle, @initials, @bio, @role, @is_guest)
    `).run({ google_id, email, username, password_hash, name, handle, initials, bio, role, is_guest });
    return this.findById(info.lastInsertRowid);
  },

  updateProfile(id, fields) {
    const cur = this.findById(id);
    const data = {
      id,
      name: fields.name != null ? fields.name : cur.name,
      bio: fields.bio !== undefined ? fields.bio : cur.bio,
      email: fields.email !== undefined ? fields.email : cur.email,
      phone: fields.phone !== undefined ? fields.phone : cur.phone,
      dob: fields.dob !== undefined ? fields.dob : cur.dob,
      initials: fields.initials != null ? fields.initials : cur.initials,
    };
    db.prepare(`
      UPDATE users SET name=@name, bio=@bio, email=@email, phone=@phone, dob=@dob, initials=@initials
      WHERE id=@id
    `).run(data);
    return this.findById(id);
  },

  setAvatar(id, fileId, mime) {
    db.prepare('UPDATE users SET avatar_file_id = ?, avatar_mime = ? WHERE id = ?').run(fileId, mime, id);
    return this.findById(id);
  },

  setPassword(id, passwordHash) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
    return this.findById(id);
  },

  // Password-reset tokens (30-min expiry handled by the caller).
  setResetToken(id, token, expiresIso) {
    db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expiresIso, id);
  },
  findByValidResetToken(token) {
    if (!token) return undefined;
    return db.prepare("SELECT * FROM users WHERE reset_token = ? AND reset_expires > datetime('now')").get(token);
  },
  clearResetToken(id) {
    db.prepare('UPDATE users SET reset_token = NULL, reset_expires = NULL WHERE id = ?').run(id);
  },

  listAll() {
    return db.prepare('SELECT * FROM users ORDER BY id').all();
  },

  // Admin edit of a user's full profile (includes username, handle, role).
  adminUpdate(id, f) {
    const cur = this.findById(id);
    const data = {
      id,
      name: f.name != null ? f.name : cur.name,
      username: f.username !== undefined ? f.username : cur.username,
      handle: f.handle !== undefined ? f.handle : cur.handle,
      email: f.email !== undefined ? f.email : cur.email,
      phone: f.phone !== undefined ? f.phone : cur.phone,
      dob: f.dob !== undefined ? f.dob : cur.dob,
      bio: f.bio !== undefined ? f.bio : cur.bio,
      role: f.role === 'admin' ? 'admin' : 'storyteller',
      initials: f.initials != null ? f.initials : cur.initials,
    };
    db.prepare(`
      UPDATE users SET name=@name, username=@username, handle=@handle, email=@email,
        phone=@phone, dob=@dob, bio=@bio, role=@role, initials=@initials
      WHERE id=@id
    `).run(data);
    return this.findById(id);
  },

  setRole(id, role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'storyteller', id);
    return this.findById(id);
  },

  // Deletes the user; books/media-rows/favourites/folders/notifications cascade
  // (foreign keys are ON). Disk media files are cleaned up by the caller.
  remove(id) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
};

// ── Collections (group folders) ───────────────────────────────────────────────
const Collections = {
  forUser: db.prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY id'),
  byId: db.prepare('SELECT * FROM collections WHERE id = ?'),

  listForUser(userId) { return this.forUser.all(userId); },
  findById(id) { return this.byId.get(id); },

  create(userId, name, theme) {
    const info = db.prepare('INSERT INTO collections (user_id, name, theme) VALUES (?, ?, ?)')
      .run(userId, name, theme);
    return this.findById(info.lastInsertRowid);
  },

  remove(id) {
    // Removing a collection un-files its folders/gallery media; it does NOT
    // delete the folders, stories or media themselves.
    db.prepare('UPDATE folders SET collection_id = NULL WHERE collection_id = ?').run(id);
    db.prepare('UPDATE gallery_images SET collection_id = NULL WHERE collection_id = ?').run(id);
    db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  },
};

// ── Folders (group stories) ───────────────────────────────────────────────────
const Folders = {
  forUser: db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY id'),
  byId: db.prepare('SELECT * FROM folders WHERE id = ?'),
  byCollection: db.prepare('SELECT * FROM folders WHERE collection_id = ? ORDER BY id'),

  listForUser(userId) { return this.forUser.all(userId); },
  listByCollection(collectionId) { return this.byCollection.all(collectionId); },
  findById(id) { return this.byId.get(id); },

  create(userId, name, theme, collectionId = null) {
    const info = db.prepare('INSERT INTO folders (user_id, name, theme, collection_id) VALUES (?, ?, ?, ?)')
      .run(userId, name, theme, collectionId);
    return this.findById(info.lastInsertRowid);
  },

  setCollection(id, collectionId) {
    db.prepare('UPDATE folders SET collection_id = ? WHERE id = ?').run(collectionId || null, id);
    return this.findById(id);
  },

  remove(id) {
    // Cascade deletes books in the folder too (mirrors the design's deleteFolder).
    db.prepare('DELETE FROM books WHERE folder_id = ?').run(id);
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  },
};

// ── Books (stories) ──────────────────────────────────────────────────────────
// Every book row carries a `likes` count (number of users who favourited it).
const BOOK_SELECT = 'SELECT b.*, (SELECT COUNT(*) FROM favourites f WHERE f.book_id = b.id) AS likes FROM books b';

// Alternate endings are child books. They belong to their parent story, so
// every listing below hides them (TOP_LEVEL) — they surface only as tabs in the
// parent's reader. findById stays unfiltered so an ending can still be opened
// and edited directly by id.
const TOP_LEVEL = ' b.parent_book_id IS NULL';

const Books = {
  byId: db.prepare(BOOK_SELECT + ' WHERE b.id = ?'),
  all: db.prepare(BOOK_SELECT + ' WHERE' + TOP_LEVEL + ' ORDER BY b.id'),
  published: db.prepare(BOOK_SELECT + " WHERE b.status = 'published' AND" + TOP_LEVEL + ' ORDER BY b.id'),
  byAuthor: db.prepare(BOOK_SELECT + ' WHERE b.author = ? AND' + TOP_LEVEL + ' ORDER BY b.id'),
  byFolder: db.prepare(BOOK_SELECT + ' WHERE b.folder_id = ? AND' + TOP_LEVEL + ' ORDER BY b.id'),
  // `folder_id = NULL` matches nothing in SQL, so unfiled stories need their own
  // statement — listByFolder(null) means "the stories in no folder".
  noFolder: db.prepare(BOOK_SELECT + ' WHERE b.folder_id IS NULL AND' + TOP_LEVEL + ' ORDER BY b.id'),
  byUser: db.prepare(BOOK_SELECT + ' WHERE b.user_id = ? AND' + TOP_LEVEL + ' ORDER BY b.id'),
  // Endings included — for sweeps that must reach every row a user owns.
  byUserAll: db.prepare(BOOK_SELECT + ' WHERE b.user_id = ? ORDER BY b.id'),
  endings: db.prepare(BOOK_SELECT + ' WHERE b.parent_book_id = ? ORDER BY b.id'),

  findById(id) { return this.byId.get(id); },
  listAll() { return this.all.all(); },
  listPublished() { return this.published.all(); },
  listByAuthor(author) { return this.byAuthor.all(author); },
  listByFolder(folderId) { return folderId == null ? this.noFolder.all() : this.byFolder.all(folderId); },
  listByUser(userId) { return this.byUser.all(userId); },
  listByUserIncludingEndings(userId) { return this.byUserAll.all(userId); },

  // Extra endings hanging off a story (the parent itself is not included).
  listEndings(parentId) { return this.endings.all(parentId); },

  // The tab strip for the endings section under a story. The story itself is
  // NOT a tab — its own photos stay above, always visible; these tabs only
  // switch which ending is shown below it.
  endingTabs(book) {
    const parent = book && book.parent_book_id ? this.findById(book.parent_book_id) : book;
    if (!parent) return [];
    return this.listEndings(parent.id).map((b, i) => ({
      id: b.id,
      label: (b.ending_label || '').trim() || `Ending ${i + 1}`,
    }));
  },

  // Make `id` an alternate ending of `parentId` (or detach when parentId is
  // null). One level only — the caller checks that the target isn't itself an
  // ending and that `id` has no endings of its own.
  setParent(id, parentId, label) {
    db.prepare("UPDATE books SET parent_book_id = ?, ending_label = ?, updated_at = datetime('now') WHERE id = ?")
      .run(parentId ?? null, (label || '').trim() || null, id);
    return this.findById(id);
  },

  setEndingLabel(id, label) {
    db.prepare("UPDATE books SET ending_label = ?, updated_at = datetime('now') WHERE id = ?")
      .run((label || '').trim() || null, id);
    return this.findById(id);
  },

  create(data) {
    const info = db.prepare(`
      INSERT INTO books (user_id, title, author, series, collection, folder_id, status, theme, year, views, blurb, type, updated_at)
      VALUES (@user_id, @title, @author, @series, @collection, @folder_id, @status, @theme, @year, @views, @blurb, @type, datetime('now'))
    `).run({
      user_id: data.user_id,
      title: data.title,
      author: data.author,
      series: data.series ?? null,
      collection: data.collection ?? null,
      folder_id: data.folder_id ?? null,
      status: data.status ?? 'private',
      theme: data.theme ?? 'terra',
      year: data.year ?? new Date().getFullYear(),
      views: data.views ?? 0,
      blurb: data.blurb ?? null,
      type: data.type === 'novel' ? 'novel' : 'story',
    });
    return this.findById(info.lastInsertRowid);
  },

  update(id, data) {
    const current = this.findById(id) || {};
    db.prepare(`
      UPDATE books SET
        title = @title, blurb = @blurb, status = @status, theme = @theme,
        cover_mode = @cover_mode,
        series = @series, collection = @collection, folder_id = @folder_id,
        is_saved = 1,
        published_at = CASE WHEN @status = 'published' THEN COALESCE(published_at, datetime('now')) ELSE published_at END,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      title: data.title,
      blurb: data.blurb ?? null,
      status: data.status ?? 'private',
      theme: data.theme ?? 'terra',
      cover_mode: ['theme', 'upload', 'first'].includes(data.cover_mode) ? data.cover_mode : (current.cover_mode || 'theme'),
      series: data.series ?? null,
      collection: data.collection ?? null,
      folder_id: data.folder_id ?? null,
    });
    return this.findById(id);
  },

  // Point a book at an uploaded cover image and switch it to 'upload' mode.
  setCover(id, mediaId) {
    db.prepare("UPDATE books SET cover_media_id = ?, cover_mode = 'upload', updated_at = datetime('now') WHERE id = ?")
      .run(mediaId, id);
    return this.findById(id);
  },

  incrementViews(id) {
    db.prepare('UPDATE books SET views = views + 1 WHERE id = ?').run(id);
    db.prepare("INSERT INTO views_log (book_id, viewed_at) VALUES (?, datetime('now'))").run(id);
  },

  // Raw view timestamps (optionally scoped to one author's stories).
  viewTimestamps(userId) {
    const sql = 'SELECT v.viewed_at AS t FROM views_log v JOIN books b ON b.id = v.book_id' + (userId != null ? ' WHERE b.user_id = ?' : '');
    return (userId != null ? db.prepare(sql).all(userId) : db.prepare(sql).all()).map((r) => r.t);
  },

  // { book_id: count } of views recorded today (local time).
  viewsTodayMap() {
    const rows = db.prepare("SELECT book_id, COUNT(*) AS n FROM views_log WHERE date(viewed_at, 'localtime') = date('now', 'localtime') GROUP BY book_id").all();
    const m = {};
    rows.forEach((r) => { m[r.book_id] = r.n; });
    return m;
  },

  setContent(id, json) {
    db.prepare("UPDATE books SET content = ?, is_saved = 1, updated_at = datetime('now') WHERE id = ?").run(json, id);
    return this.findById(id);
  },

  setTitle(id, title) {
    db.prepare("UPDATE books SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id);
    return this.findById(id);
  },

  setStatus(id, status) {
    if (status === 'published') {
      db.prepare("UPDATE books SET status = 'published', published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now') WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE books SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    }
    return this.findById(id);
  },

  // Bump updated_at without otherwise changing the row (e.g. after a media upload).
  touch(id) {
    db.prepare("UPDATE books SET updated_at = datetime('now') WHERE id = ?").run(id);
  },

  remove(id) {
    db.prepare('DELETE FROM books WHERE id = ?').run(id);
  },

  removeCollection(folderId, collectionName) {
    db.prepare('DELETE FROM books WHERE folder_id = ? AND collection = ?')
      .run(folderId, collectionName);
  },
};

// ── Media ─────────────────────────────────────────────────────────────────────
const Media = {
  // Story media grid excludes cover images (kind='cover').
  forBook: db.prepare("SELECT * FROM media WHERE book_id = ? AND kind != 'cover' ORDER BY position, id"),
  byId: db.prepare('SELECT * FROM media WHERE id = ?'),
  firstPhotoStmt: db.prepare("SELECT * FROM media WHERE book_id = ? AND kind = 'photo' ORDER BY position, id LIMIT 1"),

  listForBook(bookId) { return this.forBook.all(bookId); },
  findById(id) { return this.byId.get(id); },
  firstPhoto(bookId) { return this.firstPhotoStmt.get(bookId); },

  // Remove any previous cover image rows for a book (called before setting a new one).
  removeCovers(bookId) {
    db.prepare("DELETE FROM media WHERE book_id = ? AND kind = 'cover'").run(bookId);
  },

  create(data) {
    const info = db.prepare(`
      INSERT INTO media (book_id, label, kind, mime, file_name, file_size, telegram_file_id, telegram_unique_id, telegram_message_id, position)
      VALUES (@book_id, @label, @kind, @mime, @file_name, @file_size, @telegram_file_id, @telegram_unique_id, @telegram_message_id, @position)
    `).run({
      book_id: data.book_id,
      label: data.label ?? null,
      kind: data.kind ?? 'photo',
      mime: data.mime ?? null,
      file_name: data.file_name ?? null,
      file_size: data.file_size ?? null,
      telegram_file_id: data.telegram_file_id ?? null,
      telegram_unique_id: data.telegram_unique_id ?? null,
      telegram_message_id: data.telegram_message_id ?? null,
      position: data.position ?? 0,
    });
    return this.findById(info.lastInsertRowid);
  },

  remove(id) {
    db.prepare('DELETE FROM media WHERE id = ?').run(id);
  },

  reorder(bookId, orderedIds) {
    const stmt = db.prepare('UPDATE media SET position = ? WHERE id = ? AND book_id = ?');
    const tx = db.transaction((ids) => {
      ids.forEach((mediaId, idx) => stmt.run(idx, mediaId, bookId));
    });
    tx(orderedIds);
  },

  nextPosition(bookId) {
    const row = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM media WHERE book_id = ?').get(bookId);
    return row.pos;
  },
};

// ── Favourites ────────────────────────────────────────────────────────────────
const Favourites = {
  forUser: db.prepare('SELECT book_id FROM favourites WHERE user_id = ?'),
  totalForUserStories: db.prepare('SELECT COUNT(*) AS n FROM favourites f JOIN books b ON b.id = f.book_id WHERE b.user_id = ?'),

  idsForUser(userId) {
    return this.forUser.all(userId).map((r) => r.book_id);
  },

  // Total likes received across all stories owned by this user.
  countForUserStories(userId) {
    return this.totalForUserStories.get(userId).n;
  },

  toggle(userId, bookId) {
    const exists = db.prepare('SELECT 1 FROM favourites WHERE user_id = ? AND book_id = ?').get(userId, bookId);
    if (exists) {
      db.prepare('DELETE FROM favourites WHERE user_id = ? AND book_id = ?').run(userId, bookId);
      return false;
    }
    db.prepare("INSERT INTO favourites (user_id, book_id, created_at) VALUES (?, ?, datetime('now'))").run(userId, bookId);
    return true;
  },

  // Raw like timestamps (optionally scoped to one author's stories).
  likeTimestamps(userId) {
    const sql = 'SELECT f.created_at AS t FROM favourites f JOIN books b ON b.id = f.book_id WHERE f.created_at IS NOT NULL' + (userId != null ? ' AND b.user_id = ?' : '');
    return (userId != null ? db.prepare(sql).all(userId) : db.prepare(sql).all()).map((r) => r.t);
  },

  // { book_id: count } of likes added today (local time).
  likesTodayMap() {
    const rows = db.prepare("SELECT book_id, COUNT(*) AS n FROM favourites WHERE created_at IS NOT NULL AND date(created_at, 'localtime') = date('now', 'localtime') GROUP BY book_id").all();
    const m = {};
    rows.forEach((r) => { m[r.book_id] = r.n; });
    return m;
  },
};

// ── Notifications ─────────────────────────────────────────────────────────────
const Notifications = {
  // Recent notifications for a user, with the actor's name + story title joined in.
  recent: db.prepare(`
    SELECT n.*, a.name AS actor_name, b.title AS book_title
    FROM notifications n
    LEFT JOIN users a ON a.id = n.actor_id
    LEFT JOIN books b ON b.id = n.book_id
    WHERE n.user_id = ?
    ORDER BY n.id DESC
    LIMIT ?
  `),
  unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0'),

  listForUser(userId, limit = 20) {
    return this.recent.all(userId, limit);
  },
  unreadCount(userId) {
    return this.unread.get(userId).n;
  },
  markAllRead(userId) {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
  },
  create({ user_id, type, actor_id = null, book_id = null, message = null }) {
    return db.prepare(
      'INSERT INTO notifications (user_id, type, actor_id, book_id, message) VALUES (?, ?, ?, ?, ?)'
    ).run(user_id, type, actor_id, book_id, message);
  },

  // A "liked your story" notification — skips self-likes and avoids piling up
  // duplicates if the same person likes/unlikes/relikes the same story.
  createLike({ recipientId, actorId, bookId }) {
    if (!recipientId || recipientId === actorId) return;
    const dupe = db.prepare(
      "SELECT 1 FROM notifications WHERE user_id = ? AND type = 'like' AND actor_id = ? AND book_id = ?"
    ).get(recipientId, actorId, bookId);
    if (dupe) return;
    this.create({ user_id: recipientId, type: 'like', actor_id: actorId, book_id: bookId });
  },

  // Create at most one birthday greeting per calendar year for this user.
  ensureBirthday(user) {
    if (!user || !user.dob) return;
    const now = new Date();
    const dob = new Date(user.dob + 'T00:00:00');
    if (isNaN(dob)) return;
    if (dob.getMonth() !== now.getMonth() || dob.getDate() !== now.getDate()) return;
    const year = String(now.getFullYear());
    const existing = db.prepare(
      "SELECT 1 FROM notifications WHERE user_id = ? AND type = 'birthday' AND strftime('%Y', created_at) = ?"
    ).get(user.id, year);
    if (existing) return;
    const first = (user.name || 'there').trim().split(/\s+/)[0];
    this.create({ user_id: user.id, type: 'birthday', message: `Happy birthday, ${first}! 🎉` });
  },
};

// ── Gallery (standalone images, no story attached) ────────────────────────────
const Gallery = {
  byId: db.prepare('SELECT * FROM gallery_images WHERE id = ?'),
  newest: db.prepare('SELECT * FROM gallery_images WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC'),
  oldest: db.prepare('SELECT * FROM gallery_images WHERE user_id = ? ORDER BY datetime(created_at) ASC, id ASC'),
  newestInColl: db.prepare('SELECT * FROM gallery_images WHERE user_id = ? AND collection_id = ? ORDER BY datetime(created_at) DESC, id DESC'),
  oldestInColl: db.prepare('SELECT * FROM gallery_images WHERE user_id = ? AND collection_id = ? ORDER BY datetime(created_at) ASC, id ASC'),
  favNewest: db.prepare('SELECT * FROM gallery_images WHERE user_id = ? AND is_favourite = 1 ORDER BY datetime(created_at) DESC, id DESC'),
  favOldest: db.prepare('SELECT * FROM gallery_images WHERE user_id = ? AND is_favourite = 1 ORDER BY datetime(created_at) ASC, id ASC'),

  findById(id) { return this.byId.get(id); },
  listForUser(userId, order = 'newest', collectionId = null) {
    if (collectionId) return (order === 'oldest' ? this.oldestInColl : this.newestInColl).all(userId, collectionId);
    return (order === 'oldest' ? this.oldest : this.newest).all(userId);
  },
  listFavourites(userId, order = 'newest') {
    return (order === 'oldest' ? this.favOldest : this.favNewest).all(userId);
  },
  favouriteCount(userId) {
    return db.prepare('SELECT COUNT(*) AS c FROM gallery_images WHERE user_id = ? AND is_favourite = 1').get(userId).c;
  },
  // Toggle the favourite flag; returns the new state (true = favourited).
  toggleFavourite(id) {
    const row = this.byId.get(id);
    if (!row) return false;
    const next = row.is_favourite ? 0 : 1;
    db.prepare('UPDATE gallery_images SET is_favourite = ? WHERE id = ?').run(next, id);
    return next === 1;
  },

  // { <collection_id>: count } for the gallery tab badges.
  countsByCollection(userId) {
    const out = {};
    db.prepare('SELECT collection_id, COUNT(*) AS c FROM gallery_images WHERE user_id = ? AND collection_id IS NOT NULL GROUP BY collection_id')
      .all(userId).forEach((r) => { out[r.collection_id] = r.c; });
    return out;
  },

  create({ user_id, telegram_file_id, telegram_unique_id = null, telegram_message_id = null, mime = null, file_name = null, file_size = null, collection_id = null }) {
    const info = db.prepare(`
      INSERT INTO gallery_images (user_id, telegram_file_id, telegram_unique_id, telegram_message_id, mime, file_name, file_size, collection_id)
      VALUES (@user_id, @telegram_file_id, @telegram_unique_id, @telegram_message_id, @mime, @file_name, @file_size, @collection_id)
    `).run({ user_id, telegram_file_id, telegram_unique_id, telegram_message_id, mime, file_name, file_size, collection_id });
    return this.findById(info.lastInsertRowid);
  },

  setCollection(id, collectionId) {
    db.prepare('UPDATE gallery_images SET collection_id = ? WHERE id = ?').run(collectionId || null, id);
    return this.findById(id);
  },

  remove(id) { db.prepare('DELETE FROM gallery_images WHERE id = ?').run(id); },
};

module.exports = { db, Users, Collections, Folders, Books, Media, Favourites, Notifications, Gallery };
