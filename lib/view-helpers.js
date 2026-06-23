'use strict';

const { db, Media } = require('./queries');
const storage = require('./storage');
const { themeGradient } = require('./themes');

// Resolve a book's cover image media id based on its cover_mode.
function coverImageId(book) {
  if (!book) return null;
  if (book.cover_mode === 'upload' && book.cover_media_id) return book.cover_media_id;
  if (book.cover_mode === 'first') {
    const first = Media.firstPhoto(book.id);
    if (first) return first.id;
  }
  return null;
}

// True when the cover renders as a photo (upload or first-image mode with media).
function coverIsImage(book) {
  return coverImageId(book) != null;
}

// CSS `background` shorthand for a cover spine: an image with a legibility
// overlay, or the theme gradient as a fallback.
function coverBackground(book) {
  const id = coverImageId(book);
  if (id != null) {
    return `linear-gradient(180deg,rgba(0,0,0,0.35) 0%,rgba(0,0,0,0.12) 42%,rgba(0,0,0,0.62) 100%), url(/media/${id}) center/cover no-repeat`;
  }
  return themeGradient(book ? book.theme : 'terra');
}

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

function firstName(name = '') {
  return (name.trim().split(/\s+/)[0]) || 'there';
}

function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Telegram storage summary for the admin / settings / sidebar pills.
// Pass a userId to scope the totals to that user's media (Settings); omit it
// for the app-wide total (Admin).
function storageStats(userId) {
  const sql =
    "SELECT COUNT(*) AS files, COALESCE(SUM(m.file_size),0) AS used " +
    "FROM media m JOIN books b ON b.id = m.book_id " +
    "WHERE m.telegram_file_id IS NOT NULL" +
    (userId != null ? " AND b.user_id = ?" : "");
  const stmt = db.prepare(sql);
  const row = userId != null ? stmt.get(userId) : stmt.get();
  const channels = storage.isConfigured() ? 1 : 0;
  return {
    channels,
    files: row.files,
    used: humanSize(row.used),
  };
}

// Profile image URL (streamed from Telegram) or null to fall back to initials.
// A version token derived from the file_id busts the browser cache whenever the
// photo changes (and unsticks any previously cached/empty response).
function avatarUrl(user) {
  if (!user || !user.avatar_file_id) return null;
  let h = 0;
  const s = String(user.avatar_file_id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return '/users/' + user.id + '/avatar?v=' + (h >>> 0).toString(36);
}

// "1998-05-04" → "4 May 1998" (and age). Returns null if not set/invalid.
function formatDob(dob) {
  if (!dob) return null;
  const d = new Date(dob + 'T00:00:00');
  if (isNaN(d)) return dob;
  const formatted = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 140 ? `${formatted} · ${age} yrs` : formatted;
}

module.exports = { greeting, firstName, humanSize, storageStats, coverBackground, coverIsImage, avatarUrl, formatDob };
