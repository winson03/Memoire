# Mémoire — implementation

A faithful, multi-page implementation of the **Mémoire v3 "warm light glass"** design
(see `README.md` for the original design handoff and `Memoire v3.dc.html` for the visual
reference). Built as a real server-rendered website — **not** a single-page app — with:

- **Node + Express + EJS** — every screen is its own URL/page.
- **SQLite** (file-based, zero-config) — local database for users, stories, folders,
  collections, media metadata and favourites.
- **Telegram** — the blob store for all images, videos and PDFs. Files are uploaded to a
  private channel; only `file_id`s live in the database. Media is streamed back on demand.
- **Google OAuth** sign-in (plus a guest mode).

## Pages (each is its own route)

| URL | Screen |
|---|---|
| `/` | Landing (public marketing) |
| `/login` | Sign in (Google / guest) |
| `/dashboard` | Dashboard |
| `/folders` · `/folders?open=:id` | Folders & Collections |
| `/reader/:id` | Story reader |
| `/editor` · `/editor?id=:id` | Story editor (drag-reorder media, upload to Telegram) |
| `/favourites` | Favourites |
| `/profile` | Profile |
| `/admin` | Admin overview table (admins only) |
| `/settings` | Settings |

## Quick start

```bash
npm install
npm start          # → http://localhost:8000
```

The database is created automatically on first run and starts **empty** — no demo content.
"Discover published stories" fills in as users register and publish. Use `npm run dev` for
auto-reload.

### Making an admin

Admins see the Admin overview page (and the Admin nav link); everyone else doesn't. Promote a
user after they've registered:

```bash
npm run make-admin -- <username-or-email>          # promote
npm run make-admin -- <username-or-email> --demote # demote
```

## Configuration

All config lives in `.env` (already filled in for this environment; see `.env.example` for the
template). Key groups:

- **Telegram** — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and the self-hosted Bot API server
  settings. The app talks to the configured `TELEGRAM_BOT_API_URL` (e.g. the local
  `http://localhost:8081/bot` server, which allows uploads up to 2 GB) and **automatically
  falls back to the public `api.telegram.org`** (50 MB cap) if the local server isn't running.
  To enable 2 GB uploads, run the [telegram-bot-api](https://github.com/tdlib/telegram-bot-api)
  server with your `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`.
  **Live (Render):** the public API refuses to serve back files over 20 MB, so the deployed
  site needs its own reachable Bot API server too. Deploy the `aiogram/telegram-bot-api`
  Docker image as a Render web service (env: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`,
  `PORT=8081`; **no** `TELEGRAM_LOCAL` — the app downloads over HTTP), then point the main
  service's `TELEGRAM_BOT_API_URL` at `https://<that-service>.onrender.com/bot` and set
  `TELEGRAM_MAX_FILE_SIZE=2000`. Leave `TELEGRAM_BOT_API_LOCAL` unset/false on Render.
- **Google OAuth** — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
  (`http://localhost:8000/auth/google/callback`). The same redirect URI must be registered in
  the Google Cloud console. If unset, the Google button is disabled and guest mode still works.
- **App** — `PORT` (default 8000), `SESSION_SECRET`, `DATABASE_PATH`.

## How the design maps to code

- **Design tokens, glass surfaces, animations, every component & hover state** →
  `public/css/styles.css` (transcribed verbatim from `Memoire v3.dc.html`, including the orbs,
  `fadeUp`/`cardFloat`/`pulse` keyframes, cover-spine gradients and shadows).
- **Cover-spine theme gradients & status colours** → `lib/themes.js` (the exact 8-theme map).
- **The reusable cover card** → `views/partials/cover-card.ejs`.
- **App shell** (sidebar + sticky top bar) → `views/partials/sidebar.ejs` + `topbar.ejs`.
- **Client interactions** (dialogs, favourite toggle, drag-to-reorder media, live cover
  preview, mobile drawer) → `public/js/app.js`.

## Data & media model

```
users ─┬─ folders ─┐
       └─ books ────┴─ (folder_id)         books ─ media (telegram_file_id, kind, position)
                                           users ─ favourites ─ books
```

- Uploading media in the editor streams the file straight to Telegram (`POST
  /stories/:id/media`), stores the returned `file_id` + metadata in SQLite, and renders a
  thumbnail. Reorder (`/media/reorder`) and delete (`/media/:id/delete`) are AJAX.
- The reader/admin/settings "Telegram storage" pills reflect real counts (files, bytes used)
  computed from the `media` table.

## Notes

- Deletions go through the design's confirm dialog before mutating data.
- The editor's "+ New story" creates a draft immediately so media has a home, matching the
  prototype's always-editing-an-open-book behaviour.
- `data/*.db` and `.env` are git-ignored.
