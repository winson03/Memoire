'use strict';

// Nightly SQLite backup — snapshots the live DB (safe under WAL, no downtime)
// and uploads it to the same Telegram channel used for media storage, so a
// backup survives even if the Render persistent disk itself is lost or reset.

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');
const telegram = require('./telegram');

async function backupDatabase() {
  if (!telegram.isConfigured()) {
    console.warn('[backup] Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) — skipping.');
    return null;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const tmpPath = path.join(os.tmpdir(), `memoire-backup-${stamp}-${Date.now()}.db`);

  await db.backup(tmpPath);
  const buffer = await fs.promises.readFile(tmpPath);
  await fs.promises.unlink(tmpPath).catch(() => {});

  const rec = await telegram.uploadBuffer(buffer, `memoire-backup-${stamp}.db`, 'application/octet-stream');
  console.log(`[backup] Database backed up to Telegram (${(buffer.length / 1024).toFixed(0)} KB, file_id ${rec.file_id}).`);
  return rec;
}

module.exports = { backupDatabase };
