'use strict';

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const { Users } = require('./queries');

function initialsFromName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  try {
    done(null, Users.findById(id) || false);
  } catch (err) {
    done(err);
  }
});

// ── Local email + password ──────────────────────────────────────────────────
passport.use(new LocalStrategy(
  { usernameField: 'email', passwordField: 'password' },
  (email, password, done) => {
    try {
      const user = Users.findByEmail((email || '').trim().toLowerCase());
      if (!user || !user.password_hash) {
        return done(null, false, { message: 'Incorrect email or password.' });
      }
      if (!bcrypt.compareSync(password, user.password_hash)) {
        return done(null, false, { message: 'Incorrect email or password.' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  },
));

const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (hasGoogle) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8000/auth/google/callback',
    },
    (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        let user = Users.findByGoogleId(profile.id) || (email && Users.findByEmail(email));

        if (user && !user.google_id) {
          // Link an existing seeded account (e.g. eleanor@gmail.com) to this Google id.
          require('./db').prepare('UPDATE users SET google_id = ? WHERE id = ?').run(profile.id, user.id);
          user = Users.findById(user.id);
        }

        if (!user) {
          const name = profile.displayName || (email ? email.split('@')[0] : 'New Storyteller');
          user = Users.create({
            google_id: profile.id,
            email,
            name,
            handle: email ? email.split('@')[0] : null,
            initials: initialsFromName(name),
            role: 'storyteller',
          });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ));
}

module.exports = { passport, hasGoogle, initialsFromName };
