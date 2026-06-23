'use strict';

// One-time migration: pull every media file + avatar out of Telegram and store
// it on local disk, rewriting the stored key. Safe to re-run — already-migrated
// rows (whose key resolves to an existing disk file) are skipped.

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { db } = require('../lib/queries');
const telegram = require('../lib/telegram');
const storage = require('../lib/storage');

function alreadyOnDisk(key) {
  if (!key) return false;
  return fs.existsSync(path.join(storage.MEDIA_DIR, path.basename(String(key))));
}

(async () => {
  let ok = 0, skip = 0, fail = 0;

  const media = db.prepare('SELECT id, telegram_file_id, mime, file_name FROM media WHERE telegram_file_id IS NOT NULL').all();
  console.log(`Media to check: ${media.length}`);
  for (const m of media) {
    if (alreadyOnDisk(m.telegram_file_id)) { skip++; continue; }
    try {
      const buf = await telegram.fetchBuffer(m.telegram_file_id);
      const rec = await storage.uploadBuffer(buf, m.file_name || ('media-' + m.id), m.mime || 'application/octet-stream');
      db.prepare('UPDATE media SET telegram_file_id = ?, telegram_unique_id = NULL, telegram_message_id = NULL WHERE id = ?').run(rec.file_id, m.id);
      ok++; process.stdout.write('.');
    } catch (e) { fail++; console.log(`\n  media #${m.id} (${m.file_name}) FAILED: ${e.message}`); }
  }

  const users = db.prepare('SELECT id, avatar_file_id, avatar_mime FROM users WHERE avatar_file_id IS NOT NULL').all();
  for (const u of users) {
    if (alreadyOnDisk(u.avatar_file_id)) { skip++; continue; }
    try {
      const buf = await telegram.fetchBuffer(u.avatar_file_id);
      const rec = await storage.uploadBuffer(buf, 'avatar-' + u.id, u.avatar_mime || 'image/jpeg');
      db.prepare('UPDATE users SET avatar_file_id = ? WHERE id = ?').run(rec.file_id, u.id);
      ok++;
    } catch (e) { fail++; console.log(`\n  avatar user #${u.id} FAILED: ${e.message}`); }
  }

  console.log(`\nDone. migrated=${ok} skipped=${skip} failed=${fail}`);
  process.exit(fail ? 1 : 0);
})();
