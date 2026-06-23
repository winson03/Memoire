'use strict';

// Promote a user to admin (or demote with --demote).
// Usage:
//   npm run make-admin -- <username-or-email>
//   npm run make-admin -- <username-or-email> --demote

require('dotenv').config();
const { db, Users } = require('../lib/queries');

const args = process.argv.slice(2);
const demote = args.includes('--demote');
const ident = args.find((a) => !a.startsWith('--'));

if (!ident) {
  console.error('Usage: npm run make-admin -- <username-or-email> [--demote]');
  process.exit(1);
}

const user = Users.findByUsername(ident) || Users.findByEmail(ident);
if (!user) {
  console.error(`No user found with username/email "${ident}".`);
  process.exit(1);
}

const role = demote ? 'storyteller' : 'admin';
db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
console.log(`${user.name} (${user.username || user.email}) is now ${role}.`);
process.exit(0);
