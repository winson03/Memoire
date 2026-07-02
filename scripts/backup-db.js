'use strict';

// Snapshot the database and upload it to Telegram right now.
// Usage: npm run backup-db

require('dotenv').config();
const { backupDatabase } = require('../lib/backup');

backupDatabase()
  .then((rec) => process.exit(rec ? 0 : 1))
  .catch((err) => { console.error('[backup] failed:', err.message); process.exit(1); });
