'use strict';

const rateLimit = require('express-rate-limit');

// Shared handler: friendly flash + redirect for browsers, JSON for API calls.
function makeHandler(redirectTo) {
  return (req, res) => {
    if (req.accepts('html')) {
      if (typeof req.flash === 'function') req.flash('error', 'Too many attempts — please wait a while and try again.');
      return res.redirect(redirectTo || 'back');
    }
    res.status(429).json({ error: 'too many requests' });
  };
}

// Broad safety net for the whole app (static assets are served before this).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429);
    if (req.accepts('html')) return res.send('<p style="font-family:Georgia,serif;padding:60px;text-align:center;">Too many requests — please slow down and try again shortly.</p>');
    res.json({ error: 'too many requests' });
  },
});

// Brute-force guard for sign-in and registration.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeHandler('/login'),
});

// Password-reset flow: also stops the mailer being used to spam inboxes.
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeHandler('/forgot-password'),
});

module.exports = { globalLimiter, authLimiter, resetLimiter };
