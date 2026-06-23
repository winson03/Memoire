'use strict';

// Cover-spine gradients (3:4 dark covers) — verbatim from the design reference.
const THEMES = {
  terra: 'linear-gradient(140deg,#C2683E 0%,#8A3E22 100%)',
  sepia: 'linear-gradient(140deg,#9A6A3C 0%,#5A3414 100%)',
  olive: 'linear-gradient(140deg,#8A9A4E 0%,#4A5A22 100%)',
  blue:  'linear-gradient(140deg,#6E8794 0%,#3C5360 100%)',
  plum:  'linear-gradient(140deg,#A06A86 0%,#5A3450 100%)',
  ochre: 'linear-gradient(140deg,#D69A3A 0%,#9A6A14 100%)',
  slate: 'linear-gradient(140deg,#E0A054 0%,#B0762E 100%)',
  rose:  'linear-gradient(140deg,#D0787A 0%,#9A4448 100%)',
};

const THEME_KEYS = Object.keys(THEMES);

// Palette cycled through when a new folder is created (from the design).
const FOLDER_PALETTE = ['olive', 'plum', 'ochre', 'slate', 'rose', 'blue', 'sepia', 'terra'];

function themeGradient(theme) {
  return THEMES[theme] || THEMES.terra;
}

// Status dot colour + label, matching the design's statusStyle().
const STATUS_COLOR = {
  published: 'var(--accent,#C2683E)',
  draft: '#C99020',
  private: 'rgba(58,50,42,0.4)',
};

function statusColor(status) {
  return STATUS_COLOR[status] || 'rgba(58,50,42,0.4)';
}

function statusLabel(status) {
  if (!status) return '';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Turn a SQLite UTC datetime ("YYYY-MM-DD HH:MM:SS") into a friendly relative
// string: "just now", "5 minutes ago", "yesterday", "3 days ago", etc.
function relativeTime(value) {
  if (!value) return 'recently';
  // SQLite stores UTC without a zone marker — normalise so Date parses as UTC.
  const iso = String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z';
  const then = new Date(iso);
  if (isNaN(then)) return 'recently';

  const secs = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (secs < 45) return 'just now';
  if (mins < 60) return mins === 1 ? 'a minute ago' : `${mins} minutes ago`;
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7); return w === 1 ? 'last week' : `${w} weeks ago`; }
  if (days < 365) { const m = Math.floor(days / 30); return m === 1 ? 'last month' : `${m} months ago`; }
  const y = Math.floor(days / 365);
  return y === 1 ? 'last year' : `${y} years ago`;
}

// "1,240 readers" for published, else "Updated 2 days ago".
function metaRight(book) {
  if (book.status === 'published') {
    return Number(book.views || 0).toLocaleString('en-US') + ' readers';
  }
  return 'Updated ' + relativeTime(book.updated || book.updated_at);
}

function readersTxt(book) {
  return book.status === 'published'
    ? Number(book.views || 0).toLocaleString('en-US')
    : '—';
}

module.exports = {
  THEMES,
  THEME_KEYS,
  FOLDER_PALETTE,
  themeGradient,
  statusColor,
  statusLabel,
  metaRight,
  relativeTime,
  readersTxt,
};
