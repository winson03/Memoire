'use strict';

// One-time migration: copy every Telegram-stored media file up to Google Drive
// and rewrite its stored key to `gdrive:<id>`. Covers story media, gallery
// images, and user avatars.
//
//   npm run migrate-to-drive -- --dry-run     # read-only: report count + size
//   npm run migrate-to-drive                  # migrate everything
//   npm run migrate-to-drive -- --limit=200   # migrate at most 200 files
//
// SAFE BY DESIGN:
//   • Telegram originals are NEVER deleted — only the DB key is rewritten.
//   • Every change is logged to data/migrate-to-drive-rollback.jsonl (old→new).
//   • Re-runnable: rows already on Drive (gdrive:*) are skipped, so a stopped
//     run just resumes where it left off.
//
// WHERE TO RUN — this matters for your hosting bill:
//   Downloading from Telegram + uploading to Drive both flow through whatever
//   machine runs this. Run it on your OWN computer (against a copy of the
//   production database) to keep the traffic off your host's metered bandwidth.
//   Running it on the server works too, but the upload bytes count against your
//   host's data limit. Use --dry-run first to see how big the job is.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db } = require('../lib/queries');
const telegram = require('../lib/telegram');
const drive = require('../lib/drive');

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

const ROLLBACK_LOG = path.join(__dirname, '..', 'data', 'migrate-to-drive-rollback.jsonl');
const THROTTLE_MS = 400;           // gentle gap between files
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A key still lives on Telegram if it's set and not already a Drive key.
const onTelegram = (key) => !!key && !String(key).startsWith('gdrive:');

const gb = (bytes) => (bytes / (1024 ** 3)).toFixed(2) + ' GB';

// The three places a Telegram key is stored, each described so one loop can
// handle them all: table, id column, key column, and the file name/mime to use.
const SOURCES = [
  { table: 'media',          keyCol: 'telegram_file_id', uniqCol: 'telegram_unique_id', nameCol: 'file_name', mimeCol: 'mime', sizeCol: 'file_size' },
  { table: 'gallery_images', keyCol: 'telegram_file_id', uniqCol: 'telegram_unique_id', nameCol: 'file_name', mimeCol: 'mime', sizeCol: 'file_size' },
  { table: 'users',          keyCol: 'avatar_file_id',   uniqCol: null,                 nameCol: null,        mimeCol: 'avatar_mime', sizeCol: null },
];

function pending(src) {
  const rows = db.prepare(`SELECT * FROM ${src.table} WHERE ${src.keyCol} IS NOT NULL`).all();
  return rows.filter((r) => onTelegram(r[src.keyCol]));
}

function report() {
  console.log('\nMedia still stored on Telegram (to migrate):\n');
  let totalFiles = 0;
  let totalBytes = 0;
  for (const src of SOURCES) {
    const rows = pending(src);
    const bytes = src.sizeCol ? rows.reduce((s, r) => s + (r[src.sizeCol] || 0), 0) : 0;
    totalFiles += rows.length;
    totalBytes += bytes;
    const sizeNote = src.sizeCol ? ` — ${gb(bytes)}` : ' — (size not tracked)';
    console.log(`  ${src.table.padEnd(16)} ${String(rows.length).padStart(6)} files${sizeNote}`);
  }
  console.log(`\n  TOTAL            ${String(totalFiles).padStart(6)} files — ~${gb(totalBytes)}\n`);
  console.log('  This ~size is the bandwidth the migration will use on whatever');
  console.log('  machine runs it. Run it on your own computer to keep it off the host.\n');
  return { totalFiles, totalBytes };
}

// Drive can rate-limit rapid uploads; wait-and-retry a few times before giving up.
async function uploadWithRetry(buf, name, mime, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await drive.uploadBuffer(buf, name, mime);
    } catch (e) {
      const rateLimited = /rate limit|too many|quota|userRateLimit|\b429\b|\b403\b/i.test(e.message || '');
      if (i < attempts && rateLimited) {
        const wait = (i + 1) * 5000;
        console.log(`\n  Drive rate-limited, waiting ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function migrateRow(src, row) {
  const oldKey = row[src.keyCol];
  const name = (src.nameCol && row[src.nameCol]) || `${src.table}-${row.id}`;
  const mime = (src.mimeCol && row[src.mimeCol]) || 'application/octet-stream';

  const buf = await telegram.fetchBuffer(oldKey);          // Telegram → here
  const rec = await uploadWithRetry(buf, name, mime);      // here → Drive
  const newKey = 'gdrive:' + rec.file_id;

  // Record the old→new mapping BEFORE we overwrite it, so a rollback (or a
  // later "delete the Telegram originals" step) is always possible.
  fs.appendFileSync(ROLLBACK_LOG, JSON.stringify({
    at: new Date().toISOString(), table: src.table, id: row.id,
    old_key: oldKey, old_unique: src.uniqCol ? row[src.uniqCol] : null, new_key: newKey,
  }) + '\n');

  if (src.uniqCol) {
    db.prepare(`UPDATE ${src.table} SET ${src.keyCol} = ?, ${src.uniqCol} = ? WHERE id = ?`)
      .run(newKey, rec.file_id, row.id);
  } else {
    db.prepare(`UPDATE ${src.table} SET ${src.keyCol} = ? WHERE id = ?`).run(newKey, row.id);
  }
}

(async () => {
  if (!drive.isConfigured()) {
    console.error('Google Drive is not configured (missing Google/GDRIVE credentials). Aborting.');
    process.exit(1);
  }
  if (!telegram.isConfigured()) {
    console.error('Telegram is not configured (needed to download the originals). Aborting.');
    process.exit(1);
  }

  const { totalFiles } = report();
  if (DRY_RUN) {
    console.log('Dry run — nothing was changed. Remove --dry-run to migrate.\n');
    process.exit(0);
  }
  if (!totalFiles) { console.log('Nothing to migrate. Done.\n'); process.exit(0); }

  fs.mkdirSync(path.dirname(ROLLBACK_LOG), { recursive: true });
  console.log(`Migrating (rollback log: ${ROLLBACK_LOG})\n`);

  let ok = 0, fail = 0;
  outer:
  for (const src of SOURCES) {
    for (const row of pending(src)) {
      if (ok >= LIMIT) { console.log(`\nReached --limit=${LIMIT}. Stopping (re-run to continue).`); break outer; }
      try {
        await migrateRow(src, row);
        ok++; process.stdout.write('.');
        await sleep(THROTTLE_MS);
      } catch (e) {
        fail++;
        console.log(`\n  ${src.table} #${row.id} FAILED: ${e.message}`);
      }
    }
  }

  console.log(`\n\nDone. migrated=${ok} failed=${fail}`);
  console.log('Telegram originals were left untouched. Verify the app loads media,');
  console.log('then you can re-run to catch any failures.\n');
  process.exit(fail ? 1 : 0);
})();
