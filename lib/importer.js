'use strict';

// Save from web: turns a post link (X, Bluesky, Reddit, any page with
// og:image/og:video) or a list of direct media URLs into gallery items.
// Downloads run one at a time in the background (the host has 0.5 CPU and
// 512 MB), streamed to a temp file, then stored like a normal upload.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const axios = require('axios');
const db = require('./db');
const storage = require('./storage');
const { Gallery, Folders, Notifications } = require('./queries');

// ── Safe fetching (no requests to private / internal addresses) ─────────────
const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]]
  .forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

// True for loopback, private, link-local and other internal addresses
// (IPv4-mapped IPv6 like ::ffff:127.0.0.1 is checked as the IPv4 inside).
function isBlockedIp(addr) {
  const a = String(addr || '').replace(/^\[|\]$/g, '');
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const fam = net.isIP(a);
  if (!fam) return false;
  return blocked.check(a, fam === 6 ? 'ipv6' : 'ipv4');
}

// Hosts written as raw IPs never reach the DNS lookup below, so check them here.
function assertPublicHost(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || (net.isIP(h) && isBlockedIp(h))) {
    throw new Error('Address not allowed');
  }
}

function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: options.family || 4 }];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad) return cb(new Error('Address not allowed'));
    if (options.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}
const agentOpts = { lookup: safeLookup, keepAlive: false };
const client = axios.create({
  httpAgent: new http.Agent(agentOpts),
  httpsAgent: new https.Agent(agentOpts),
  timeout: 30000,
  maxRedirects: 5,
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
  validateStatus: (s) => s >= 200 && s < 300,
  // Every redirect hop gets the same raw-IP check.
  beforeRedirect: (options) => assertPublicHost(options.hostname),
});
client.interceptors.request.use((config) => {
  const u = new URL(config.url, config.baseURL);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Address not allowed');
  assertPublicHost(u.hostname);
  return config;
});

function httpUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u : null;
  } catch (_) { return null; }
}

// Dedupe key: the media file's origin + path (signed query strings change).
function sourceKey(url) {
  const u = httpUrl(url);
  return u ? (u.origin + u.pathname).slice(0, 1000) : null;
}

const MAX_BYTES = Number(process.env.STORAGE_MAX_FILE_SIZE || 2048) * 1024 * 1024;
const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  heic: 'image/heic', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

function guessMime(url, headerType) {
  const t = String(headerType || '').split(';')[0].trim().toLowerCase();
  if (t.startsWith('image/') || t.startsWith('video/')) return t;
  const u = httpUrl(url);
  if (!u) return null;
  const fmt = u.searchParams.get('format'); // pbs.twimg.com/media/X?format=jpg
  const ext = (fmt || path.extname(u.pathname).slice(1)).toLowerCase();
  return EXT_MIME[ext] || null;
}

// Stream one media URL to a temp file. Resolves { file, mime, size }.
function friendly(e) {
  if (e && e.response) return new Error(`The site refused the request (${e.response.status}).`);
  if (e && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT')) return new Error('The site took too long to answer.');
  if (e && e.code === 'ENOTFOUND') return new Error('That site could not be found.');
  return e;
}

async function download(url) {
  const res = await client.get(url, { responseType: 'stream', timeout: 120000 }).catch((e) => { throw friendly(e); });
  const mime = guessMime(url, res.headers['content-type']);
  if (!mime || mime === 'image/svg+xml') {
    res.data.destroy();
    throw new Error('Not a photo or video');
  }
  const len = Number(res.headers['content-length'] || 0);
  if (len && len > MAX_BYTES) { res.data.destroy(); throw new Error('File too large'); }
  const file = path.join(os.tmpdir(), `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let size = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    res.data.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) res.data.destroy(new Error('File too large'));
    });
    res.data.on('error', (e) => { out.destroy(); reject(e); });
    out.on('error', reject);
    out.on('finish', resolve);
    res.data.pipe(out);
  }).catch((e) => { fs.promises.unlink(file).catch(() => {}); throw e; });
  if (!size) { fs.promises.unlink(file).catch(() => {}); throw new Error('Empty file'); }
  return { file, mime, size };
}

// ── Link resolvers ──────────────────────────────────────────────────────────
// Each returns { source, items: [{ url, name? }] } or throws.

function xToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}
function bestMp4(variants) {
  return (variants || [])
    .filter((v) => (v.content_type || v.type) === 'video/mp4' && (v.url || v.src))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
}
function xPhoto(u) {
  const m = String(u).match(/^https:\/\/pbs\.twimg\.com\/media\/([\w-]+)(?:\.(\w+))?/);
  return m ? `https://pbs.twimg.com/media/${m[1]}?format=${m[2] || 'jpg'}&name=orig` : u;
}

async function resolveX(id) {
  const items = [];
  try {
    const { data } = await client.get('https://cdn.syndication.twimg.com/tweet-result', {
      params: { id, lang: 'en', token: xToken(id) }, timeout: 15000,
    });
    (data && data.mediaDetails || []).forEach((m) => {
      if (m.type === 'photo') items.push({ url: xPhoto(m.media_url_https) });
      else {
        const v = bestMp4(m.video_info && m.video_info.variants);
        if (v) items.push({ url: v.url });
      }
    });
  } catch (_) { /* fall through to the backup */ }
  if (!items.length) {
    try {
      const { data } = await client.get(`https://api.fxtwitter.com/status/${id}`, { timeout: 15000 });
      const media = (data && data.tweet && data.tweet.media && data.tweet.media.all) || [];
      media.forEach((m) => {
        if (m.type === 'photo') items.push({ url: xPhoto(m.url) });
        else if (m.url) items.push({ url: m.url });
      });
    } catch (_) { /* nothing */ }
  }
  if (!items.length) throw new Error('No photos or videos found on that post (it may be private or marked sensitive — use the browser extension for those).');
  return { source: 'X', items };
}

async function resolveBluesky(u) {
  const m = u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/);
  if (!m) throw new Error('Not a Bluesky post link');
  const uri = `at://${m[1]}/app.bsky.feed.post/${m[2]}`;
  const { data } = await client.get('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread', { params: { uri, depth: 0 }, timeout: 15000 });
  const embed = data && data.thread && data.thread.post && data.thread.post.embed;
  const imgs = (embed && (embed.images || (embed.media && embed.media.images))) || [];
  const items = imgs.map((i) => ({ url: i.fullsize })).filter((i) => i.url);
  if (!items.length) throw new Error('No photos found on that post (Bluesky videos are not supported yet).');
  return { source: 'Bluesky', items };
}

async function resolveReddit(u) {
  const jsonUrl = u.origin.replace('://old.', '://www.') + u.pathname.replace(/\/$/, '') + '.json';
  const { data } = await client.get(jsonUrl, { timeout: 15000 });
  const post = data && data[0] && data[0].data && data[0].data.children[0] && data[0].data.children[0].data;
  if (!post) throw new Error('Could not read that Reddit post');
  const unesc = (s) => String(s || '').replace(/&amp;/g, '&');
  const items = [];
  if (post.is_gallery && post.media_metadata) {
    const order = (post.gallery_data && post.gallery_data.items || []).map((i) => i.media_id);
    order.forEach((id) => {
      const mm = post.media_metadata[id];
      const src = mm && mm.s && (mm.s.u || mm.s.gif || mm.s.mp4);
      if (src) items.push({ url: unesc(src) });
    });
  } else if (/\.(jpe?g|png|gif|webp)$/i.test(post.url || '')) {
    items.push({ url: unesc(post.url) });
  }
  if (!items.length) throw new Error('No photos found on that post (Reddit videos are not supported yet).');
  return { source: 'Reddit', items };
}

// Any other page: a direct media file, or the page's og:video / og:image.
async function resolveGeneric(u) {
  const res = await client.get(u.href, { responseType: 'stream', timeout: 20000 }).catch((e) => { throw friendly(e); });
  const type = String(res.headers['content-type'] || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('video/')) {
    res.data.destroy();
    return { source: u.hostname.replace(/^www\./, ''), items: [{ url: u.href }] };
  }
  if (!type.includes('html')) { res.data.destroy(); throw new Error('That link is not a photo, video or web page.'); }
  let html = '';
  await new Promise((resolve) => {
    res.data.on('data', (c) => { html += c; if (html.length > 1024 * 1024) res.data.destroy(); });
    res.data.on('end', resolve); res.data.on('close', resolve); res.data.on('error', resolve);
  });
  const metas = {};
  html.replace(/<meta\s[^>]*>/gi, (tag) => {
    const key = (tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/content\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (key && val && !metas[key.toLowerCase()]) metas[key.toLowerCase()] = val.replace(/&amp;/g, '&');
    return tag;
  });
  const pick = metas['og:video:secure_url'] || metas['og:video:url'] || metas['og:video']
    || metas['og:image:secure_url'] || metas['og:image'] || metas['twitter:image'];
  const abs = pick && httpUrl(new URL(pick, u.href).href);
  if (!abs) throw new Error('No photo or video found on that page.');
  return { source: u.hostname.replace(/^www\./, ''), items: [{ url: abs.href }] };
}

async function resolveLink(raw) {
  try { return await resolveLinkInner(raw); } catch (e) { throw friendly(e); }
}

async function resolveLinkInner(raw) {
  const u = httpUrl(raw);
  if (!u) throw new Error('That doesn’t look like a web link.');
  const host = u.hostname.replace(/^(www\.|mobile\.|m\.)/, '').toLowerCase();
  if (['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'].includes(host)) {
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/);
    if (!m) throw new Error('Open a single post on X and share that link.');
    return resolveX(m[1]);
  }
  if (host === 'bsky.app') return resolveBluesky(u);
  if (host === 'reddit.com' || host === 'old.reddit.com') return resolveReddit(u);
  if (host.endsWith('patreon.com')) throw new Error('Patreon posts need the browser extension (they are only visible when you are signed in).');
  return resolveGeneric(u);
}

// ── Jobs ────────────────────────────────────────────────────────────────────
const Imports = {
  create(userId, { source, link, folderId, total }) {
    const info = db.prepare('INSERT INTO imports (user_id, source, link, folder_id, total) VALUES (?, ?, ?, ?, ?)')
      .run(userId, source || null, link ? String(link).slice(0, 1000) : null, folderId || null, total);
    return info.lastInsertRowid;
  },
  get(id) { return db.prepare('SELECT * FROM imports WHERE id = ?').get(id); },
  recent(userId, n = 12) {
    return db.prepare(`SELECT i.*, f.name AS folder_name FROM imports i LEFT JOIN folders f ON f.id = i.folder_id
      WHERE i.user_id = ? ORDER BY i.id DESC LIMIT ?`).all(userId, n);
  },
  set(id, fields) {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE imports SET ${keys.map((k) => k + ' = @' + k).join(', ')} WHERE id = @id`).run({ ...fields, id });
  },
};

const queue = [];
let running = false;

function ownFolder(userId, raw) {
  const fid = parseInt(raw, 10);
  if (!fid) return null;
  const f = Folders.findById(fid);
  return f && f.user_id === userId ? f.id : null;
}

// Queue a job. items: [{ url, name? }] (direct media URLs) and/or
// files: [{ path, mime, name }] (bytes already received). Returns the job row.
function enqueue(userId, { source, link, folderId, items = [], files = [] }) {
  const seen = new Set();
  const clean = items
    .map((i) => ({ url: httpUrl(i.url) && httpUrl(i.url).href, name: i.name ? String(i.name).slice(0, 200) : null }))
    .filter((i) => i.url && !seen.has(i.url) && seen.add(i.url))
    .slice(0, 100);
  const fid = ownFolder(userId, folderId);
  const total = clean.length + files.length;
  const id = Imports.create(userId, { source, link, folderId: fid, total });
  queue.push({ id, userId, folderId: fid, source, items: clean, files });
  setImmediate(pump);
  return Imports.get(id);
}

async function saveOne(job, { file, mime, size, name, key }) {
  const ext = MIME_EXT[mime] || (mime.startsWith('video/') ? 'mp4' : 'jpg');
  const fileName = (name && /\.\w{2,4}$/.test(name)) ? name : `${(job.source || 'web').replace(/[^\w.-]+/g, '-').toLowerCase()}-${Date.now()}.${ext}`;
  const rec = await storage.saveFile(file, fileName, mime);
  const img = Gallery.create({
    user_id: job.userId,
    telegram_file_id: rec.file_id,
    telegram_unique_id: rec.unique_id,
    telegram_message_id: rec.message_id,
    mime: rec.mime || mime,
    file_name: rec.file_name || fileName,
    file_size: rec.file_size || size,
    folder_id: job.folderId,
    source_url: key,
  });
  const kind = mime.startsWith('video/') ? 'video' : 'photo';
  if (kind === 'photo' && fs.existsSync(file)) {
    await storage.warmThumbs(img.telegram_file_id, 'photo', { source: file, widths: [640] }).catch(() => {});
  } else {
    storage.queueWarm(img.telegram_file_id, kind, kind === 'photo' ? { widths: [640] } : {});
  }
}

async function runJob(job) {
  Imports.set(job.id, { status: 'running' });
  let saved = 0; let skipped = 0; let failed = 0; let lastErr = null;
  const tick = () => Imports.set(job.id, { saved, skipped, failed });

  for (const f of job.files) {
    if (f.key && Gallery.findBySource(job.userId, f.key)) {
      fs.promises.unlink(f.path).catch(() => {});
      skipped += 1; tick(); continue;
    }
    try { await saveOne(job, { file: f.path, mime: f.mime, size: f.size, name: f.name, key: f.key || null }); saved += 1; }
    catch (e) { failed += 1; lastErr = e.message; console.error('[import] file', e.message); }
    finally { fs.promises.unlink(f.path).catch(() => {}); }
    tick();
  }
  for (const it of job.items) {
    const key = sourceKey(it.url);
    if (key && Gallery.findBySource(job.userId, key)) { skipped += 1; tick(); continue; }
    let dl = null;
    try {
      dl = await download(it.url);
      await saveOne(job, { ...dl, name: it.name, key });
      saved += 1;
    } catch (e) {
      failed += 1; lastErr = e.message;
      console.error('[import]', job.source, e.message);
    } finally {
      if (dl && dl.file) fs.promises.unlink(dl.file).catch(() => {});
    }
    tick();
  }

  const status = saved || skipped ? 'done' : 'error';
  Imports.set(job.id, { status, error: failed ? (lastErr || 'Some items failed') : null });
  if (saved) {
    const where = job.folderId ? (Folders.findById(job.folderId) || {}).name : null;
    Notifications.create({
      user_id: job.userId, type: 'upload', book_id: null,
      message: `${saved} ${saved === 1 ? 'item' : 'items'} saved from ${job.source || 'the web'}${where ? ' to ' + where : ''}`,
    });
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try { await runJob(job); }
      catch (e) { Imports.set(job.id, { status: 'error', error: e.message }); }
    }
  } finally { running = false; }
}

module.exports = { resolveLink, enqueue, Imports, sourceKey, guessMime, httpUrl, ownFolder, MAX_BYTES };
