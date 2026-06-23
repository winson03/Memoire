'use strict';

const express = require('express');
const router = express.Router();
const { Books } = require('../lib/queries');
const { hasGoogle } = require('../lib/passport');

// Landing — public marketing page.
router.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/dashboard');
  const discover = Books.listPublished().slice(0, 8);
  res.render('landing', { discover });
});

// Login screen.
router.get('/login', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('login', { googleEnabled: hasGoogle, prefill: process.env.DEV_LOGIN_PREFILL || '' });
});

// Create-account screen.
router.get('/register', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('register', {});
});

// Forgot-password screen (request a reset link).
router.get('/forgot-password', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('forgot-password', {});
});

// Reset-password screen (set a new password via token).
router.get('/reset-password', (req, res) => {
  const token = req.query.token || '';
  const { Users } = require('../lib/queries');
  if (!Users.findByValidResetToken(token)) {
    req.flash('error', 'That reset link is invalid or has expired.');
    return res.redirect('/forgot-password');
  }
  res.render('reset-password', { token });
});

module.exports = router;
