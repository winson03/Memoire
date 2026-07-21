'use strict';

// Small key-value store for app-level state that outlives a request but isn't
// tied to a user — the Google Drive OAuth refresh token, the admin's fast
// preview switch. Backed by the app_settings table (see lib/db.js).

const db = require('./db');

function get(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function set(key, value) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function del(key) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

// Booleans are stored as '1' / '0'.
function getBool(key) { return get(key) === '1'; }
function setBool(key, on) { set(key, on ? '1' : '0'); }

module.exports = { get, set, del, getBool, setBool };
