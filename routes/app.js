'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const { Users, Books, Folders, Collections, Favourites, Notifications, Media, Gallery } = require('../lib/queries');
const { greeting, firstName, storageStats } = require('../lib/view-helpers');
const { statusLabel, readersTxt } = require('../lib/themes');
const storage = require('../lib/storage');
const drive = require('../lib/drive');
const bcrypt = require('bcryptjs');

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

function initialsFromName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Filter a list of books by the search query (title/author/series/collection).
function filt(list, q) {
  const query = (q || '').trim().toLowerCase();
  if (!query) return list;
  return list.filter((b) =>
    `${b.title} ${b.author} ${b.series || ''} ${b.collection || ''}`.toLowerCase().includes(query));
}

// Parse a SQLite datetime ('YYYY-MM-DD HH:MM:SS', UTC) into a JS Date.
function parseTs(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d) => { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); }; // Monday

// Build empty time buckets for a range (day/week/month/year).
function buildBuckets(range) {
  const now = new Date();
  const buckets = [];
  if (range === 'week') {
    for (let i = 11; i >= 0; i--) { const s = startOfWeek(addDays(now, -i * 7)); buckets.push({ start: s, end: addDays(s, 7), label: `${s.getDate()}/${s.getMonth() + 1}`, count: 0 }); }
  } else if (range === 'month') {
    for (let i = 11; i >= 0; i--) { const s = new Date(now.getFullYear(), now.getMonth() - i, 1); buckets.push({ start: s, end: new Date(s.getFullYear(), s.getMonth() + 1, 1), label: s.toLocaleString('en-US', { month: 'short' }), count: 0 }); }
  } else if (range === 'year') {
    for (let i = 5; i >= 0; i--) { const y = now.getFullYear() - i; buckets.push({ start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: String(y), count: 0 }); }
  } else { // day — last 14 days
    for (let i = 13; i >= 0; i--) { const s = startOfDay(addDays(now, -i)); buckets.push({ start: s, end: addDays(s, 1), label: `${s.getDate()}/${s.getMonth() + 1}`, count: 0 }); }
  }
  return buckets;
}

// Count a list of timestamp strings into range buckets → [{ label, count }].
function bucketCounts(tsList, range) {
  const buckets = buildBuckets(range);
  tsList.forEach((s) => {
    const t = parseTs(s);
    if (!t) return;
    const bk = buckets.find((x) => t >= x.start && t < x.end);
    if (bk) bk.count++;
  });
  return buckets.map((b) => ({ label: b.label, count: b.count }));
}

const isTodayTs = (s) => { const t = parseTs(s); const start = startOfDay(new Date()); return !!t && t >= start && t < addDays(start, 1); };

router.use(ensureAuth);

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const u = req.user;
  const q = req.query.q || '';
  const mine = Books.listByUser(u.id);
  // Dashboard's "Your library" mixes your latest stories and gallery photos in
  // one strip (like the /library page), newest first, capped at a few. The full
  // combined list lives on /library. Photos are hidden while searching.
  const shownStories = filt(mine, q);
  const myImages = q ? [] : Gallery.listForUser(u.id);
  const libraryItems = [
    ...shownStories.map((b) => ({ type: 'story', book: b, date: b.created_at || '' })),
    ...myImages.map((i) => ({ type: 'photo', img: i, date: i.created_at || '' })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  // Dashboard shows only the hottest published stories (most readers); the full
  // list lives on the paginated /discover page.
  const hot = filt(Books.listPublished(), q)
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 5);
  res.render('dashboard', {
    greeting: greeting(),
    firstName: firstName(u.name),
    libCount: mine.length,
    publishedCount: mine.filter((b) => b.status === 'published').length,
    libraryItems,
    discover: hot,
  });
});

// ── Library (your stories + gallery photos, grouped by folder/collection) ─────
// Folders (which group stories) and gallery collections (which group photos)
// are merged into one set of tabs, keyed by name (case-insensitive). A folder
// and a collection that share a name become a single combined tab showing both
// its stories and its photos; a name that exists on only one side gets its own
// tab. The "All" tab shows everything.
router.get('/library', (req, res) => {
  const u = req.user;
  const q = req.query.q || '';
  const norm = (s) => (s || '').trim().toLowerCase();

  const books = Books.listByUser(u.id);
  const folders = Folders.listForUser(u.id);
  const collections = Collections.listForUser(u.id);
  const allImages = Gallery.listForUser(u.id, 'newest');

  // Union folders + collections into tabs keyed by normalised name.
  const tabMap = new Map();
  const ensure = (name) => {
    const k = norm(name);
    if (!tabMap.has(k)) tabMap.set(k, { key: k, name, folderIds: [], collectionIds: [] });
    return tabMap.get(k);
  };
  folders.forEach((f) => ensure(f.name).folderIds.push(f.id));
  collections.forEach((c) => ensure(c.name).collectionIds.push(c.id));

  const booksIn = (ids) => books.filter((b) => ids.includes(b.folder_id));
  const imagesIn = (ids) => allImages.filter((i) => ids.includes(i.collection_id));

  // Active tab from ?tab=<name> (normalised); missing/unknown → the "All" tab.
  const active = req.query.tab != null ? (tabMap.get(norm(req.query.tab)) || null) : null;

  const tabs = [...tabMap.values()].map((t) => ({
    name: t.name,
    storyCount: booksIn(t.folderIds).length,
    photoCount: imagesIn(t.collectionIds).length,
    active: active ? active.key === t.key : false,
    href: '/library?tab=' + encodeURIComponent(t.name),
  }));

  const stories = active ? booksIn(active.folderIds) : books;
  const images = active ? imagesIn(active.collectionIds) : allImages;
  const shownStories = filt(stories, q);

  // Sort mode, remembered in the session so it sticks across pages and visits.
  // A ?sort= in the URL overrides and updates the saved choice.
  const SORTS = ['favourites', 'oldest', 'latest', 'az', 'za'];
  let sort = req.query.sort;
  if (sort && SORTS.includes(sort)) req.session.librarySort = sort;
  else sort = req.session.librarySort;
  if (!SORTS.includes(sort)) sort = 'latest';

  // One combined list of cards — stories and photos together (photos are hidden
  // while searching, which filters stories only), then sorted by the chosen
  // mode. Paginate it: rendering every card at once put hundreds of cover/photo
  // images in the DOM, and mobile Safari keeps each decoded image in memory
  // (even off-screen ones it caches), which crashes the tab. A bounded page
  // keeps the image count — and memory — in check, and each page navigation
  // frees the previous page entirely.
  const favSet = new Set(Favourites.idsForUser(u.id));
  const items = [
    ...shownStories.map((b) => ({
      type: 'story', book: b,
      date: b.created_at || '', title: b.title || '', faved: favSet.has(b.id),
    })),
    ...(q ? [] : images.map((i) => ({
      type: 'photo', img: i,
      date: i.created_at || '', title: i.label || i.file_name || '', faved: !!i.is_favourite,
    }))),
  ];
  const byDateDesc = (a, b) => String(b.date).localeCompare(String(a.date)); // newest first
  const byName = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  const comparators = {
    latest: byDateDesc,
    oldest: (a, b) => byDateDesc(b, a),
    az: byName,
    za: (a, b) => byName(b, a),
    favourites: (a, b) => (Number(b.faved) - Number(a.faved)) || byDateDesc(a, b),
  };
  items.sort(comparators[sort]);
  const perPage = 24;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
  const pageItems = items.slice((page - 1) * perPage, page * perPage);

  res.render('library', {
    tabs,
    activeTab: active ? { name: active.name } : null,
    allActive: !active,
    allCount: books.length + allImages.length,
    items: pageItems,
    storyTotal: shownStories.length,
    photoTotal: images.length,
    page,
    totalPages,
    query: q,
    sort, // the active library sort mode (remembered in the session)
    // Every story you own, for the "Make endings of…" chooser — the grid is
    // paginated, so the page's own cards aren't a complete list of targets.
    allStories: books.map((b) => ({ id: b.id, title: b.title })),
    folders, // feeds the bulk-import popup's "add to folder" dropdown
    collections, // feeds the gallery-import popup's "assign to collection" chooser
  });
});

// ── Discover (all published stories, paginated) ───────────────────────────────
router.get('/discover', (req, res) => {
  const q = req.query.q || '';
  const perPage = 10;
  const all = filt(Books.listPublished(), q).sort((a, b) => b.id - a.id); // newest first
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
  const books = all.slice((page - 1) * perPage, page * perPage);
  res.render('discover', { books, page, totalPages, total, query: q });
});

// ── Folders ───────────────────────────────────────────────────────────────────
// Hierarchy: Folders → Stories. (Collections feature disabled.)
router.get('/folders', (req, res) => {
  const u = req.user;
  const q = req.query.q || '';
  const rawFolders = Folders.listForUser(u.id);

  // Build folder view-models (story count + cover thumbnails).
  const folderVM = (f) => {
    const fb = Books.listByFolder(f.id);
    return { ...f, count: fb.length, covers: fb.slice(0, 3) };
  };

  // Collections disabled — pass empty/null so the view's leftover guards are inert.
  const collections = [];
  const selectedCollection = null;
  // const rawCollections = Collections.listForUser(u.id);
  // const collections = rawCollections.map((c) => {
  //   const inside = rawFolders.filter((f) => f.collection_id === c.id);
  //   return { ...c, folderCount: inside.length, folderThemes: inside.slice(0, 3).map((f) => f.theme) };
  // });
  // const selId = parseInt(req.query.collection, 10);
  // const selectedCollection = selId ? rawCollections.find((c) => c.id === selId) || null : null;

  const folders = rawFolders.map(folderVM);

  // Open folder detail → its stories as one flat grid.
  let openFolder = null;
  let folderBooks = [];
  const openId = parseInt(req.query.open, 10);
  if (openId) {
    const f = rawFolders.find((x) => x.id === openId);
    if (f) { openFolder = f; folderBooks = filt(Books.listByFolder(f.id), q); }
  }

  res.render('folders', { collections, folders, selectedCollection, openFolder, folderBooks });
});

// ── Favourites ─────────────────────────────────────────────────────────────────
router.get('/favourites', (req, res) => {
  const u = req.user;
  const q = req.query.q || '';
  const norm = (s) => (s || '').trim().toLowerCase();

  const ids = Favourites.idsForUser(u.id);
  // A favourite stays visible only while it's public or owned by the user.
  const allFavBooks = Books.listAll().filter((b) => ids.includes(b.id) && (b.status === 'published' || b.user_id === u.id));
  const allFavImages = Gallery.listFavourites(u.id);

  // Same tab model as the library: folders (grouping stories) and gallery
  // collections (grouping photos) merged by name — but only tabs that actually
  // hold a favourited item are shown.
  const folders = Folders.listForUser(u.id);
  const collections = Collections.listForUser(u.id);
  const tabMap = new Map();
  const ensure = (name) => {
    const k = norm(name);
    if (!tabMap.has(k)) tabMap.set(k, { key: k, name, folderIds: [], collectionIds: [] });
    return tabMap.get(k);
  };
  folders.forEach((f) => ensure(f.name).folderIds.push(f.id));
  collections.forEach((c) => ensure(c.name).collectionIds.push(c.id));

  const booksIn = (fids) => allFavBooks.filter((b) => fids.includes(b.folder_id));
  const imagesIn = (cids) => allFavImages.filter((i) => cids.includes(i.collection_id));

  const active = req.query.tab != null ? (tabMap.get(norm(req.query.tab)) || null) : null;
  const tabs = [...tabMap.values()]
    .map((t) => ({
      key: t.key, name: t.name, folderIds: t.folderIds, collectionIds: t.collectionIds,
      count: booksIn(t.folderIds).length + imagesIn(t.collectionIds).length,
    }))
    .filter((t) => t.count > 0)
    .map((t) => ({ ...t, active: active ? active.key === t.key : false, href: '/favourites?tab=' + encodeURIComponent(t.name) }));

  const favBooks = active ? booksIn(active.folderIds) : allFavBooks;
  const favImagesRaw = active ? imagesIn(active.collectionIds) : allFavImages;
  const shownBooks = filt(favBooks, q);
  // Photos are hidden while searching (search filters stories only).
  const favImages = q ? [] : favImagesRaw;

  // Stories and photos in ONE grid, newest first — no separate sections.
  const items = [
    ...shownBooks.map((b) => ({ type: 'story', book: b, date: b.created_at || '' })),
    ...favImages.map((i) => ({ type: 'photo', img: i, date: i.created_at || '' })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // Paginated like the library — same mixed grid, same page size.
  const perPage = 24;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);

  res.render('favourites', {
    items: items.slice((page - 1) * perPage, page * perPage),
    page,
    totalPages,
    tabs,
    activeTab: active ? { name: active.name } : null,
    allActive: !active,
    allCount: allFavBooks.length + allFavImages.length,
    storyTotal: shownBooks.length,
    photoTotal: favImagesRaw.length,
    query: q,
  });
});

// ── Profile ──────────────────────────────────────────────────────────────────
router.get('/profile', (req, res) => {
  const u = req.user;
  const mine = Books.listByUser(u.id);
  const stats = {
    stories: mine.length,
    published: mine.filter((b) => b.status === 'published').length,
    folders: Folders.listForUser(u.id).length,
    readers: mine.reduce((a, b) => a + (b.views || 0), 0),
    likes: Favourites.countForUserStories(u.id),
  };
  res.render('profile', { yourBooks: mine, stats });
});

// ── Reports — today's views & likes per story ─────────────────────────────────
router.get('/reports', (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const scope = isAdmin && req.query.scope === 'all' ? 'all' : 'mine';
  const range = ['day', 'week', 'month', 'year'].includes(req.query.chart) ? req.query.chart : 'day';
  const userId = scope === 'all' ? null : req.user.id;

  const viewTs = Books.viewTimestamps(userId);
  const likeTs = Favourites.likeTimestamps(userId);

  const viewsChart = bucketCounts(viewTs, range);
  const likesChart = bucketCounts(likeTs, range);
  const totalViewsToday = viewTs.filter(isTodayTs).length;
  const totalLikesToday = likeTs.filter(isTodayTs).length;

  res.render('reports', { isAdmin, scope, range, viewsChart, likesChart, totalViewsToday, totalLikesToday });
});

// ── Public author profile ───────────────────────────────────────────────────
// A read-only view of any storyteller, reachable from a story byline. Shows
// only their published stories and public stats — never email or phone.
router.get('/u/:id', (req, res) => {
  const author = Users.findById(parseInt(req.params.id, 10));
  if (!author) return res.redirect('/dashboard');

  const published = Books.listByUser(author.id).filter((b) => b.status === 'published');
  const stats = {
    published: published.length,
    readers: published.reduce((a, b) => a + (b.views || 0), 0),
    likes: published.reduce((a, b) => a + (b.likes || 0), 0),
  };
  res.render('author', { author, books: published, stats, isSelf: !!(req.user && req.user.id === author.id) });
});

// ── Notifications ────────────────────────────────────────────────────────────
router.post('/notifications/read', (req, res) => {
  Notifications.markAllRead(req.user.id);
  res.redirect(req.get('Referer') || '/dashboard');
});

// Edit profile form.
router.get('/profile/edit', (req, res) => {
  res.render('profile-edit', {});
});

// Save profile — name, email, phone, date of birth, bio, and an optional avatar.
router.post('/profile', avatarUpload.single('avatar'), async (req, res, next) => {
  const name = (req.body.name || '').trim() || req.user.name;
  const phone = (req.body.phone || '').trim() || null;
  const dob = (req.body.dob || '').trim() || null;
  const bio = (req.body.bio || '').trim() || null;

  try {
    // Email is fixed after sign-up — not updated here (admins change it via Users → Edit).
    Users.updateProfile(req.user.id, { name, phone, dob, bio, initials: initialsFromName(name) });

    if (req.file) {
      if (!(req.file.mimetype || '').startsWith('image/')) {
        req.flash('error', 'Profile image must be an image file.');
        return res.redirect('/profile/edit');
      }
      const tg = await storage.uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, { asDocument: true });
      Users.setAvatar(req.user.id, tg.file_id, tg.mime);
    }
    req.flash('info', 'Profile updated.');
    res.redirect('/profile');
  } catch (err) {
    next(err);
  }
});

// Change (or first-time set) the account password.
router.post('/profile/password', (req, res) => {
  const current = req.body.current_password || '';
  const next = req.body.new_password || '';
  const confirm = req.body.confirm_password || '';
  const hasPassword = !!req.user.password_hash;

  const fail = (msg) => { req.flash('error', msg); return res.redirect('/profile/edit'); };

  if (hasPassword && !bcrypt.compareSync(current, req.user.password_hash)) return fail('Current password is incorrect.');
  if (next.length < 8) return fail('New password must be at least 8 characters.');
  if (next !== confirm) return fail('New passwords do not match.');

  Users.setPassword(req.user.id, bcrypt.hashSync(next, 10));
  req.flash('info', hasPassword ? 'Password updated.' : 'Password set.');
  res.redirect('/profile/edit');
});

// Stream a user's profile image from Telegram.
router.get('/users/:id/avatar', async (req, res) => {
  const user = Users.findById(parseInt(req.params.id, 10));
  if (!user || !user.avatar_file_id) return res.status(404).send('No avatar');
  try {
    await storage.streamTo(user.avatar_file_id, res, { mime: user.avatar_mime, inline: true });
  } catch (err) {
    if (!res.headersSent) res.status(502).send('Could not load avatar.');
  }
});

// ── Admin ──────────────────────────────────────────────────────────────────────
router.get('/admin', ensureAdmin, (req, res) => {
  const q = req.query.q || '';
  const books = Books.listAll();
  const folders = Folders.listForUser(req.user.id);
  const folderName = (id) => (folders.find((f) => f.id === id) || {}).name;

  const adminStats = [
    { label: 'Total stories', value: String(books.length) },
    { label: 'Published', value: String(books.filter((b) => b.status === 'published').length) },
    { label: 'Drafts & private', value: String(books.filter((b) => b.status !== 'published').length) },
    { label: 'Total readers', value: books.reduce((a, b) => a + (b.views || 0), 0).toLocaleString('en-US') },
  ];

  adminStats.push({ label: 'Users', value: String(Users.listAll().length) });

  // Paginated stories table (10 per page), newest first.
  const filtered = filt(books, q).map((b) => ({ ...b, folderName: folderName(b.folder_id) })).sort((a, b) => b.id - a.id);
  const perPage = 10;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
  const adminRows = filtered.slice((page - 1) * perPage, page * perPage);

  // Publish chart (daily / weekly / monthly / yearly).
  const chartRange = ['day', 'week', 'month', 'year'].includes(req.query.chart) ? req.query.chart : 'day';
  const publishedBooks = books.filter((b) => b.status === 'published' && b.published_at);
  const chart = bucketCounts(publishedBooks.map((b) => b.published_at), chartRange);
  const todayKey = new Date();
  const publishedToday = publishedBooks.filter((b) => {
    const t = parseTs(b.published_at);
    return t && t >= startOfDay(todayKey) && t < addDays(startOfDay(todayKey), 1);
  }).length;

  res.render('admin', {
    adminStats, adminRows, storage: storageStats(), page, totalPages, total, query: q,
    chart, chartRange, publishedToday,
  });
});

// Admin: change a story's visibility (published / private / draft) for any user.
router.post('/admin/stories/:id/status', ensureAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = ['published', 'private', 'draft'].includes(req.body.status) ? req.body.status : null;
  const book = Books.findById(id);
  if (book && status) Books.setStatus(id, status);
  res.redirect(req.get('Referer') || '/admin');
});

// Admin: delete any user's story (bypasses the owner-only check on /stories/:id/delete).
router.post('/admin/stories/:id/delete', ensureAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const book = Books.findById(id);
  if (book) {
    Media.listForBook(id).forEach((m) => storage.remove(m.telegram_file_id));
    Books.remove(id);
  }
  res.redirect(req.get('Referer') || '/admin');
});

// Admin: users management — paginated (10 per page), searchable.
router.get('/admin/users', ensureAdmin, (req, res) => {
  const q = (req.query.q || '').trim();
  const books = Books.listAll();
  let all = Users.listAll();
  if (q) {
    const ql = q.toLowerCase();
    all = all.filter((u) => `${u.name} ${u.username || ''} ${u.email || ''} ${u.phone || ''}`.toLowerCase().includes(ql));
  }
  const perPage = 10;
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
  const users = all.slice((page - 1) * perPage, page * perPage).map((u) => ({
    ...u,
    storyCount: books.filter((b) => b.user_id === u.id).length,
    isSelf: u.id === req.user.id,
  }));
  res.render('admin-users', { users, page, totalPages, total, query: q });
});

// Admin: new-user form.
router.get('/admin/users/new', ensureAdmin, (req, res) => {
  res.render('admin-user-new', { form: {} });
});

// Admin: create a user (local account with email + password).
router.post('/admin/users', ensureAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const phone = (req.body.phone || '').trim() || null;
  const dob = (req.body.dob || '').trim() || null;
  const bio = (req.body.bio || '').trim() || null;
  const role = req.body.role === 'admin' ? 'admin' : 'storyteller';

  const fail = (msg) => {
    req.flash('error', msg);
    return res.render('admin-user-new', { form: { name, username, email, phone, dob, bio, role } });
  };

  if (!name) return fail('Please enter a name.');
  if (username && !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return fail('Username must be 3–32 characters (letters, numbers, . _ -).');
  if (username && Users.findByUsername(username)) return fail('That username is already taken.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email address.');
  if (Users.findByEmail(email)) return fail('That email is already registered.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');

  const user = Users.create({
    name,
    username: username || null,
    handle: username || null,
    email,
    password_hash: bcrypt.hashSync(password, 10),
    initials: initialsFromName(name),
    bio,
    role,
  });
  if (phone || dob) Users.updateProfile(user.id, { phone, dob });
  req.flash('info', `Created ${name}.`);
  res.redirect('/admin/users');
});

// Admin: edit a user's full profile.
router.get('/admin/users/:id/edit', ensureAdmin, (req, res) => {
  const u = Users.findById(parseInt(req.params.id, 10));
  if (!u) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
  res.render('admin-user-edit', { u, isSelf: u.id === req.user.id });
});

router.post('/admin/users/:id', ensureAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = Users.findById(id);
  if (!target) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }

  const name = (req.body.name || '').trim() || target.name;
  const username = (req.body.username || '').trim() || null;
  const email = (req.body.email || '').trim().toLowerCase() || null;
  const phone = (req.body.phone || '').trim() || null;
  const dob = (req.body.dob || '').trim() || null;
  const bio = (req.body.bio || '').trim() || null;
  const newPassword = req.body.new_password || '';
  // Can't change your own role here (avoids locking yourself out of admin).
  const role = id === req.user.id ? target.role : (req.body.role === 'admin' ? 'admin' : 'storyteller');

  const fail = (msg) => { req.flash('error', msg); return res.redirect('/admin/users/' + id + '/edit'); };

  if (username && !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return fail('Username must be 3–32 characters (letters, numbers, . _ -).');
  if (username) { const c = Users.findByUsername(username); if (c && c.id !== id) return fail('That username is taken.'); }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email address.');
  if (email) { const c = Users.findByEmail(email); if (c && c.id !== id) return fail('That email is already in use.'); }
  if (newPassword && newPassword.length < 8) return fail('New password must be at least 8 characters.');

  Users.adminUpdate(id, { name, username, handle: username || target.handle, email, phone, dob, bio, role, initials: initialsFromName(name) });
  if (newPassword) Users.setPassword(id, bcrypt.hashSync(newPassword, 10));
  req.flash('info', `Updated ${name}.`);
  res.redirect('/admin/users');
});

// Admin: promote / demote a user's role.
router.post('/admin/users/:id/role', ensureAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    req.flash('error', 'You can’t change your own role.');
    return res.redirect(req.get('Referer') || '/admin/users');
  }
  const target = Users.findById(id);
  if (!target) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  const role = req.body.role === 'admin' ? 'admin' : 'storyteller';
  Users.setRole(id, role);
  req.flash('info', `${target.name} is now ${role === 'admin' ? 'an admin' : 'a storyteller'}.`);
  res.redirect(req.get('Referer') || '/admin/users');
});

// Admin: delete a user (and their stories/media).
router.post('/admin/users/:id/delete', ensureAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    req.flash('error', 'You can’t delete your own account here.');
    return res.redirect(req.get('Referer') || '/admin/users');
  }
  const target = Users.findById(id);
  if (!target) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }
  // Remove this user's media files from disk before the rows cascade away.
  Books.listByUserIncludingEndings(id).forEach((b) => Media.listForBook(b.id).forEach((m) => storage.remove(m.telegram_file_id)));
  if (target.avatar_file_id) storage.remove(target.avatar_file_id);
  Users.remove(id);
  req.flash('info', `Deleted ${target.name} and their stories.`);
  res.redirect('/admin/users');
});

// ── Google Drive: mint a browser-direct resumable upload session ──────────────
// Big videos upload straight from the browser to Google (the session URL is
// bound to our origin for CORS), bypassing this server's body-size and memory
// limits. The client then registers the finished file via the register-drive
// endpoints, which verify the file against the Drive API.
router.post('/drive/upload-session', async (req, res) => {
  if (!drive.isConfigured()) return res.status(400).json({ error: 'Google Drive is not connected.' });
  const size = parseInt(req.body && req.body.size, 10);
  if (!size || size <= 0) return res.status(400).json({ error: 'Missing file size.' });
  try {
    const origin = req.get('Origin') || `${req.protocol}://${req.get('host')}`;
    const url = await drive.createUploadSession({
      fileName: String((req.body.file_name || 'upload')).slice(0, 200),
      mime: String(req.body.mime || 'application/octet-stream'),
      size,
      origin,
    });
    res.json({ url });
  } catch (err) {
    console.error('[drive session]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Settings ─────────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  // Live-probe Google Drive for the admin status pill (skipped for regular
  // users — the Storage section is admin-only anyway).
  let driveStatus = {
    configured: drive.isConfigured(),
    connected: false,
    user: null,
    reason: null,
    mode: drive.authMode(),
    oauthAvailable: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    token: null,
  };
  if (req.user.role === 'admin') {
    if (driveStatus.configured) {
      const check = await drive.checkConnection();
      driveStatus.connected = check.connected;
      driveStatus.user = check.user || null;
      driveStatus.reason = check.reason || null;
    }
    driveStatus.token = drive.storedToken();
  }
  res.render('settings', {
    storage: storageStats(),
    driveStatus,
    driveMinMb: Number(process.env.GDRIVE_VIDEO_MIN_MB || 15),
  });
});

// ── Settings: connect Google Drive (admin) ────────────────────────────────────
// Reuses the app's Google OAuth client with the narrow drive.file scope; the
// refresh token is stored in app_settings. The redirect URI
// (<APP_URL>/settings/drive/callback) must be registered on the OAuth client
// in the Google Cloud console.
function driveRedirectUri(req) {
  const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/settings/drive/callback`;
}

router.get('/settings/drive/connect', ensureAdmin, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    req.flash('error', 'Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
    return res.redirect('/settings');
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', driveRedirectUri(req));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', drive.oauthScope);
  u.searchParams.set('access_type', 'offline'); // ask for a refresh token
  u.searchParams.set('prompt', 'consent');      // re-issue one even if already granted
  res.redirect(u.toString());
});

router.get('/settings/drive/callback', ensureAdmin, async (req, res) => {
  try {
    if (req.query.error) throw new Error(req.query.error);
    if (!req.query.code) throw new Error('no authorization code returned');
    const axios = require('axios');
    const { data } = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code: req.query.code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: driveRedirectUri(req),
      grant_type: 'authorization_code',
    }), { timeout: 30000 });
    if (!data.refresh_token) {
      throw new Error('Google did not return a refresh token — remove the app at myaccount.google.com/permissions and connect again.');
    }
    drive.saveRefreshToken(data.refresh_token);
    req.flash('info', 'Google Drive connected — large videos will be stored there.');
  } catch (err) {
    const detail = err.response && err.response.data && (err.response.data.error_description || err.response.data.error);
    req.flash('error', 'Google Drive connect failed: ' + (detail || err.message));
  }
  res.redirect('/settings');
});

router.post('/settings/drive/disconnect', ensureAdmin, (req, res) => {
  drive.disconnect();
  req.flash('info', 'Google Drive disconnected. Already-uploaded videos stay in Drive but can no longer be played.');
  res.redirect('/settings');
});

router.post('/settings/account', (req, res) => {
  Users.updateProfile(req.user.id, { name: req.body.name || req.user.name, bio: req.user.bio });
  req.flash('info', 'Account updated.');
  res.redirect('/settings');
});

router.post('/settings/reconnect', (req, res) => {
  req.flash('info', 'Storage is local — always connected.');
  res.redirect('/settings');
});

router.post('/settings/delete-account', (req, res, next) => {
  const userId = req.user.id;
  req.logout((err) => {
    if (err) return next(err);
    Users.byId && require('../lib/queries').db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.redirect('/');
  });
});

module.exports = router;
