'use strict';

// Ensure an admin account exists, driven by environment variables.
//
// Runs once at server startup. This is the reliable way to have an admin on
// hosts with an ephemeral disk (e.g. Render's free tier), where the SQLite DB
// is wiped on every redeploy — the admin is simply re-created each boot.
//
// Env vars:
//   ADMIN_EMAIL     (required to do anything)
//   ADMIN_PASSWORD  (required when the admin must be created)
//   ADMIN_USERNAME  (optional, defaults to the part before @ in the email)
//   ADMIN_NAME      (optional, defaults to the username)
//
// Idempotent: if the user already exists it is promoted to admin (and its
// password reset to ADMIN_PASSWORD when one is provided).

const bcrypt = require('bcryptjs');
const { db, Users } = require('./queries');
const { initialsFromName } = require('./passport');

function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return; // nothing configured — skip silently

  const password = process.env.ADMIN_PASSWORD || '';
  const username = (process.env.ADMIN_USERNAME || email.split('@')[0]).trim();
  const name = (process.env.ADMIN_NAME || username).trim();

  const existing = Users.findByEmail(email) || Users.findByUsername(username);

  if (existing) {
    if (existing.role !== 'admin') {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', existing.id);
    }
    if (password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(bcrypt.hashSync(password, 10), existing.id);
    }
    console.log(`[seed-admin] ensured admin: ${existing.email || existing.username}`);
    return;
  }

  if (!password) {
    console.warn('[seed-admin] ADMIN_EMAIL set but no matching user and no ADMIN_PASSWORD — skipping create.');
    return;
  }

  Users.create({
    email,
    username,
    password_hash: bcrypt.hashSync(password, 10),
    name,
    handle: username,
    initials: initialsFromName(name),
    role: 'admin',
  });
  console.log(`[seed-admin] created admin: ${email}`);
}

module.exports = { seedAdmin };
