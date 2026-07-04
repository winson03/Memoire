'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { passport, hasGoogle, initialsFromName } = require('../lib/passport');
const { Users } = require('../lib/queries');
const { authLimiter, resetLimiter } = require('../middleware/rate-limit');
const mailer = require('../lib/mailer');

// Reset tokens are stored hashed so a leaked DB (or DB backup) can't be used
// to take over accounts; only the emailed link holds the raw token.
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ── Google OAuth ──────────────────────────────────────────────────────────────
if (hasGoogle) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/login', failureFlash: 'Google sign-in failed.' }),
    (req, res) => res.redirect('/dashboard'),
  );
}

// ── Local sign-in (username + password) ─────────────────────────────────────────
router.post('/login', authLimiter, passport.authenticate('local', {
  successRedirect: '/dashboard',
  failureRedirect: '/login',
  failureFlash: true,
}));

// ── Register a local account ────────────────────────────────────────────────────
// Required: username, email, password. Optional: phone, date of birth.
router.post('/register', authLimiter, (req, res, next) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const phone = (req.body.phone || '').trim() || null;
  const dob = (req.body.dob || '').trim() || null;

  const fail = (msg) => { req.flash('error', msg); return res.redirect('/register'); };

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return fail('Username must be 3–32 characters (letters, numbers, . _ -).');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email address.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (Users.findByUsername(username)) return fail('That username is already taken.');
  if (Users.findByEmail(email)) return fail('That email is already registered.');

  try {
    const user = Users.create({
      username,
      email,
      password_hash: bcrypt.hashSync(password, 10),
      name: username,
      handle: username,
      initials: initialsFromName(username),
      role: 'storyteller',
    });
    if (phone || dob) Users.updateProfile(user.id, { phone, dob });
    req.login(user, (err) => {
      if (err) return next(err);
      res.redirect('/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

// ── Forgot password — email a reset link ────────────────────────────────────────
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = email ? Users.findByEmail(email) : null;

  // Only send to real local-password accounts, but always show the same message
  // so we never reveal which emails exist.
  if (user && user.password_hash) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    Users.setResetToken(user.id, hashToken(token), expires);
    const url = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
    try { await mailer.sendPasswordReset(user.email, user.name, url); } catch (e) { console.error('[forgot-password]', e.message); }
  }
  req.flash('info', 'If that email has an account, a reset link is on its way.');
  res.redirect('/login');
});

// ── Reset password — consume the token ──────────────────────────────────────────
router.post('/reset-password', resetLimiter, (req, res) => {
  const token = req.body.token || '';
  const user = token ? Users.findByValidResetToken(hashToken(token)) : null;
  if (!user) {
    req.flash('error', 'That reset link is invalid or has expired.');
    return res.redirect('/forgot-password');
  }
  const password = req.body.password || '';
  if (password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect('/reset-password?token=' + encodeURIComponent(token));
  }
  if (password !== (req.body.confirm_password || '')) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('/reset-password?token=' + encodeURIComponent(token));
  }
  Users.setPassword(user.id, bcrypt.hashSync(password, 10));
  Users.clearResetToken(user.id);
  req.flash('info', 'Password updated — please sign in.');
  res.redirect('/login');
});

// ── Logout ─────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

module.exports = router;
