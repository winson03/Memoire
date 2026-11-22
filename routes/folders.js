'use strict';

// Folders hold a memory's stories AND its photos/videos (they're browsed on the
// Library page). Create and delete live here.

const express = require('express');
const router = express.Router();
const { ensureAuth } = require('../middleware/auth');
const { Folders } = require('../lib/queries');
const { FOLDER_PALETTE } = require('../lib/themes');
const storage = require('../lib/storage');

router.use(ensureAuth);

const wantsJson = (req) => req.get('X-Requested-With') === 'fetch' || (req.get('Accept') || '').includes('application/json');

// Create a folder (theme cycles). Form posts land in the new folder; fetch
// calls (folder upload) get JSON back. With `reuse`, an existing folder of the
// same name is returned instead of making a duplicate.
router.post('/', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 120);
  if (!name) return wantsJson(req) ? res.status(400).json({ error: 'Folder name is required.' }) : res.redirect('/library');
  let folder = req.body.reuse ? Folders.findByName(req.user.id, name) : null;
  if (!folder) {
    const existing = Folders.listForUser(req.user.id);
    folder = Folders.create(req.user.id, name, FOLDER_PALETTE[existing.length % FOLDER_PALETTE.length], null);
  }
  if (wantsJson(req)) return res.json({ id: folder.id, name: folder.name });
  res.redirect('/library?folder=' + folder.id);
});

// Delete a folder AND everything in it — its stories (with their endings and
// media) and its photos/videos — permanently. Owner only.
router.post('/:id/delete', (req, res) => {
  const folder = Folders.findById(parseInt(req.params.id, 10));
  if (folder && folder.user_id === req.user.id) {
    Folders.contentKeys(folder.id).forEach((k) => storage.remove(k));
    Folders.removeWithContents(folder.id);
  }
  res.redirect('/library');
});

module.exports = router;
