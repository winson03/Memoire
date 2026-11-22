# Product

Mémoire turns personal photos, letters, PDFs and films into book-like "stories" and novels, organised into folders, a gallery and collections, then published or kept private.

## Platform

web

## Stack

Node 22 + Express 4, server-rendered EJS, plain CSS (`public/css/styles.css`) and vanilla JS (`public/js/app.js`). SQLite (better-sqlite3). Media originals on Google Drive (older ones on Telegram); thumbnails and a video cache on a 10 GB Render disk.

## Users

- **Storytellers**: family members and friends who write and read stories.
- **Admins**: the site owner (and anyone promoted). Uses the admin area to watch system health, manage users, moderate stories, and check growth. All four tasks matter.

## Product Purpose

A private-feeling home for a family's memories, readable like a book.

## Positioning

Personal archive and storytelling, not a social network or a CMS.

## Operating Context

Admin pages are used on a laptop and on a phone, in short check-ins. Host is a small Render instance (0.5 CPU, 512 MB), so pages must stay light: no heavy client frameworks.

## Capabilities and Constraints

Admin data available today: story counts (total / published / private), total readers, likes, users, stories published per day/week/month/year, per-story table (title, author, folder, visibility, readers, likes, delete), users list (add, edit, role, delete), storage status (Drive connected), Reports (views and likes charts). System facts the server could expose: disk free, thumbnail and video-cache size, back-fill progress, last nightly backup, memory.

## Brand Commitments

Logo at `public/img/logo.png`. The admin redesign may replace the current warm cream/terracotta glass look (user chose "fully new looks", 2026-11-22).

## Evidence on Hand

Existing views: `views/admin.ejs`, `views/admin-users.ejs`, `views/reports.ejs`, `views/settings.ejs`.

## Product Principles

- Memories first: the admin serves the stories, it never feels like an enterprise console.
- Destructive actions are confirmed and explain what is lost.
- Fast on a weak server and a phone.

## Accessibility & Inclusion

WCAG AA contrast, keyboard reachable controls, works at phone width.
