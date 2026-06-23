'use strict';

const express = require('express');
const router = express.Router();
const { ensureAuth } = require('../middleware/auth');
const { Collections } = require('../lib/queries');
const { FOLDER_PALETTE } = require('../lib/themes');

router.use(ensureAuth);

// Create a collection (a group of folders). Theme cycles through the palette.
router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/folders');
  const existing = Collections.listForUser(req.user.id);
  const theme = FOLDER_PALETTE[existing.length % FOLDER_PALETTE.length];
  const coll = Collections.create(req.user.id, name, theme);
  res.redirect('/folders?collection=' + coll.id);
});

// Delete a collection — its folders are un-filed, not deleted.
router.post('/:id/delete', (req, res) => {
  const coll = Collections.findById(parseInt(req.params.id, 10));
  if (coll && coll.user_id === req.user.id) Collections.remove(coll.id);
  res.redirect('/folders');
});

module.exports = router;
