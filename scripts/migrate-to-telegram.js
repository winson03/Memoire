'use strict';

// One-time migration: push every disk-stored media file + avatar up to Telegram
// and rewrite the stored key to the returned file_id. The reverse of
// migrate-to-disk.js. Safe to re-run — rows whose key is already a Telegram
// file_id (i.e. no matching file on disk) are skipped.
//
// Run with Telegram configured:  npm run migrate-to-telegram
// Disk files are left in place; remove ./data/media by hand once you've
// confirmed everything loads from Telegram.

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { db } = require('../lib/queries');
const telegram = require('../lib/telegram');
const storage = require('../lib/storage');

// A key points at disk if a file with that basename exists in MEDIA_DIR.
function diskPath(key) {
  if (!key) return null;
  const p = path.join(storage.MEDIA_DIR, path.basename(String(key)));
  return fs.existsSync(p) ? p : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Small gap between uploads to stay under the public API's rate limit, plus an
// automatic wait-and-retry when Telegram answers "Too Many Requests: retry
// after N".
const THROTTLE_MS = 1500;
async function uploadWithRetry(buf, name, mime, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await telegram.uploadBuffer(buf, name, mime);
    } catch (e) {
      const m = /retry after (\d+)/i.exec(e.message || '');
      if (m && i < attempts) {
        const wait = (parseInt(m[1], 10) + 1) * 1000;
        console.log(`\n  rate-limited, waiting ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

(async () => {
  if (!telegram.isConfigured()) {
    console.error('Telegram is not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID). Aborting.');
    process.exit(1);
  }

  let ok = 0, skip = 0, fail = 0;

  const media = db.prepare('SELECT id, telegram_file_id, mime, file_name FROM media WHERE telegram_file_id IS NOT NULL').all();
  console.log(`Media to check: ${media.length}`);
  for (const m of media) {
    const src = diskPath(m.telegram_file_id);
    if (!src) { skip++; continue; } // already a Telegram file_id
    try {
      const buf = await fs.promises.readFile(src);
      const rec = await uploadWithRetry(buf, m.file_name || ('media-' + m.id), m.mime || 'application/octet-stream');
      db.prepare('UPDATE media SET telegram_file_id = ?, telegram_unique_id = ?, telegram_message_id = ? WHERE id = ?')
        .run(rec.file_id, rec.unique_id, rec.message_id, m.id);
      ok++; process.stdout.write('.');
      await sleep(THROTTLE_MS);
    } catch (e) { fail++; console.log(`\n  media #${m.id} (${m.file_name}) FAILED: ${e.message}`); }
  }

  const users = db.prepare('SELECT id, avatar_file_id, avatar_mime FROM users WHERE avatar_file_id IS NOT NULL').all();
  for (const u of users) {
    const src = diskPath(u.avatar_file_id);
    if (!src) { skip++; continue; }
    try {
      const buf = await fs.promises.readFile(src);
      const rec = await uploadWithRetry(buf, 'avatar-' + u.id, u.avatar_mime || 'image/jpeg');
      db.prepare('UPDATE users SET avatar_file_id = ? WHERE id = ?').run(rec.file_id, u.id);
      ok++;
      await sleep(THROTTLE_MS);
    } catch (e) { fail++; console.log(`\n  avatar user #${u.id} FAILED: ${e.message}`); }
  }

  console.log(`\nDone. migrated=${ok} skipped=${skip} failed=${fail}`);
  process.exit(fail ? 1 : 0);
})();
