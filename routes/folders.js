'use strict';

const express = require('express');
const router = express.Router();
const { ensureAuth } = require('../middleware/auth');
const { Folders, Collections } = require('../lib/queries');
const { FOLDER_PALETTE } = require('../lib/themes');

router.use(ensureAuth);

// Create a folder, optionally inside a collection (?collection=ID). Theme cycles.
router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/folders');
  const existing = Folders.listForUser(req.user.id);
  const theme = FOLDER_PALETTE[existing.length % FOLDER_PALETTE.length];

  let collectionId = null;
  const cid = parseInt(req.query.collection || req.body.collection_id, 10);
  if (cid) {
    const coll = Collections.findById(cid);
    if (coll && coll.user_id === req.user.id) collectionId = coll.id;
  }

  const folder = Folders.create(req.user.id, name, theme, collectionId);
  res.redirect('/folders?open=' + folder.id);
});

// Move a folder into a collection (or out of one with an empty value).
router.post('/:id/collection', (req, res) => {
  const folder = Folders.findById(parseInt(req.params.id, 10));
  if (folder && folder.user_id === req.user.id) {
    let collectionId = null;
    const cid = parseInt(req.body.collection_id, 10);
    if (cid) {
      const coll = Collections.findById(cid);
      if (coll && coll.user_id === req.user.id) collectionId = coll.id;
    }
    Folders.setCollection(folder.id, collectionId);
  }
  res.redirect(req.body.redirect || '/folders');
});

// Delete a folder (and its stories) — owner only.
router.post('/:id/delete', (req, res) => {
  const folder = Folders.findById(parseInt(req.params.id, 10));
  if (folder && folder.user_id === req.user.id) Folders.remove(folder.id);
  res.redirect('/folders');
});

module.exports = router;
