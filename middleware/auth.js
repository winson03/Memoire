'use strict';

const { Favourites, Notifications } = require('../lib/queries');

// Gate the app shell — unauthenticated visitors are sent to the login screen.
function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.accepts('html')) return res.redirect('/login');
  return res.status(401).json({ error: 'unauthorized' });
}

// Admin-only routes.
function ensureAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).send('Forbidden');
}

// Expose the current user + their favourite ids to every view.
function locals(req, res, next) {
  res.locals.currentUser = req.user || null;
  res.locals.favIds = req.user ? Favourites.idsForUser(req.user.id) : [];
  res.locals.query = req.query.q || '';
  res.locals.path = req.path;
  if (req.user) {
    Notifications.ensureBirthday(req.user);
    res.locals.notifications = Notifications.listForUser(req.user.id, 15);
    res.locals.notifUnread = Notifications.unreadCount(req.user.id);
  } else {
    res.locals.notifications = [];
    res.locals.notifUnread = 0;
  }
  next();
}

module.exports = { ensureAuth, ensureAdmin, locals };
