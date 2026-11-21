'use strict';

// One-pass back-fill of thumbnails and video posters for media uploaded before
// thumbnails were made at upload time. Runs inside the web server shortly after
// boot, one file at a time with a pause between files, so it never competes
// with visitors for memory. Anything already on disk is skipped with a cheap
// stat, so once the first full pass has finished, later boots are near-instant.
//
// Disable with THUMB_BACKFILL=off. THUMB_BACKFILL_DELAY_MS sets the pause
// between files (default 1500).

const { db } = require('./queries');
const storage = require('./storage');

const PAUSE_MS = Math.max(0, Number(process.env.THUMB_BACKFILL_DELAY_MS) || 1500);
const START_DELAY_MS = 60 * 1000; // let the server settle after boot first
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every item worth a thumbnail, with the sizes its pages request.
function collectJobs() {
  const jobs = [];
  for (const m of db.prepare(
    "SELECT telegram_file_id AS key, kind FROM media WHERE telegram_file_id IS NOT NULL AND kind IN ('photo','cover','video') ORDER BY id DESC"
  ).all()) {
    jobs.push({ key: m.key, kind: m.kind });
  }
  for (const g of db.prepare(
    "SELECT telegram_file_id AS key, mime FROM gallery_images WHERE telegram_file_id IS NOT NULL ORDER BY id DESC"
  ).all()) {
    const mime = g.mime || '';
    if (mime.startsWith('video/')) jobs.push({ key: g.key, kind: 'video' });
    else if (mime.startsWith('image/')) jobs.push({ key: g.key, kind: 'photo', widths: [640] });
  }
  // Video posters only come from Google Drive's previews; videos stored
  // elsewhere have no poster source, so don't spend time on them.
  return jobs.filter((j) => j.kind !== 'video' || String(j.key).startsWith('gdrive:'));
}

let running = false;

async function backfillThumbs() {
  if (running) return;
  running = true;
  const started = Date.now();
  let made = 0, skipped = 0, failed = 0;
  try {
    const jobs = collectJobs();
    console.log(`[backfill] checking ${jobs.length} media items for thumbnails in ${storage.THUMB_DIR}`);
    for (const job of jobs) {
      if (storage.hasThumbs(job.key, job.kind, job.widths)) { skipped += 1; continue; }
      const ok = await storage.warmThumbs(job.key, job.kind, job.widths ? { widths: job.widths } : {}).catch(() => false);
      if (ok) made += 1; else failed += 1;
      if ((made + failed) % 25 === 0) {
        console.log(`[backfill] progress: ${made} made, ${failed} failed, ${skipped} already done (of ${jobs.length})`);
      }
      await sleep(PAUSE_MS);
    }
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`[backfill] done in ${mins} min: ${made} made, ${failed} failed, ${skipped} already done`);
  } catch (err) {
    console.error('[backfill] stopped:', err.message);
  } finally {
    running = false;
  }
}

function scheduleBackfill() {
  if (String(process.env.THUMB_BACKFILL || '').toLowerCase() === 'off') return;
  setTimeout(() => { backfillThumbs(); }, START_DELAY_MS).unref();
}

module.exports = { backfillThumbs, scheduleBackfill };
