# Handoff: Mémoire — Story Library Platform

## Overview
Mémoire is a web app for turning personal photos, letters and films into beautiful, book-like "stories," organising them into folders and collections, and publishing them (or keeping them private). It has a public marketing landing page, a Google sign-in screen, and an authenticated app (dashboard, folders/collections, story reader, story editor, favourites, profile, admin table, settings). Media is conceptually stored in a private Telegram channel and streamed on demand (a backend concern — the UI just reflects connection status).

This is the **v3 "warm light glass"** direction: a cream background, frosted-glass panels, terracotta→gold accents, dark photo-cover spines, and soft motion (drifting background orbs, floating hero cards, staggered fade-ups, hover lifts).

## About the Design Files
The single file in this bundle — `Memoire v3.dc.html` — is a **design reference created in HTML**. It is a prototype showing the intended look, layout, copy and interactions. It is **not production code to copy directly**: it runs on a proprietary preview runtime (a `<x-dc>` custom element + `support.js`), uses `{{ }}` template holes, `<sc-if>`/`<sc-for>` control-flow tags, and inline-style objects.

**Your task is to recreate these designs in your target codebase's environment** (React, Vue, Svelte, SwiftUI, etc.) using its established patterns, component library and styling approach. If no codebase exists yet, pick the most appropriate framework (a React + Vite or Next.js app with CSS Modules / Tailwind is a natural fit) and implement there. Treat the HTML as the source of truth for *appearance and behavior*, not structure.

Open the file in a browser to see it live, or read it as source to extract exact values (everything below is already transcribed for you).

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, shadows and interactions are final. Recreate the UI pixel-closely using your codebase's libraries and patterns. The dummy data (story titles, authors, view counts) is placeholder content — replace with real data.

---

## Architecture at a glance
A single-page app with a screen router held in state. Two unauthenticated screens (`landing`, `login`) render full-bleed; the eight authenticated screens render inside a persistent **app shell** (fixed sidebar + sticky top bar + scrolling content area).

```
screen ∈ landing | login | dashboard | folders | reader | editor
                 | favourites | profile | admin | settings
authed: boolean   // gates the app shell; sign-in sets it true
```

Behind everything (z-index 0) sits a fixed full-viewport layer of three blurred radial-gradient "orbs" that drift slowly. All screen content sits at z-index 1.

---

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| Background (Cream) | `#F6EDE1` | default page background |
| Background (Linen) | `#F1E6D6` | alt tint option |
| Background (Blush) | `#F4E8E4` | alt tint option |
| Ink / primary text | `#3A322A` | headings, body |
| Accent (from) | `#C2683E` | terracotta — primary accent, gradient start |
| Accent (to) | `#E0A054` | gold — gradient end |
| Danger | `#B8463C` (text) / `#C8564A`→`#9A332A` (gradient) | delete actions |
| Draft status | `#C99020` | amber dot |
| Private status | `rgba(58,50,42,0.4)` | muted dot |
| Cover spine: white text | `#FFF8F0` | text on photo covers |

**Text opacity ramp on ink** (`#3A322A`): 1.0 headings · 0.62 body · 0.58/0.55 secondary · 0.48/0.45 meta · 0.4/0.35 faint.

**Glass surfaces** (the core motif): `background: rgba(255,255,255,0.5)` (panels) / `0.55`–`0.6` (sidebar, buttons) / `0.4` (top bar) / `0.72` (dialog); `border: 1px solid rgba(255,255,255,0.7–0.85)`; `backdrop-filter: blur(18–34px)` (always also `-webkit-backdrop-filter`); `box-shadow: 0 10px 30px rgba(120,80,50,0.08)`.

**Cover spine gradients** (3:4 cards, dark for contrast against cream):
| Theme | Gradient (140deg) |
|---|---|
| terra | `#C2683E → #8A3E22` |
| sepia | `#9A6A3C → #5A3414` |
| olive | `#8A9A4E → #4A5A22` |
| blue | `#6E8794 → #3C5360` |
| plum | `#A06A86 → #5A3450` |
| ochre | `#D69A3A → #9A6A14` |
| slate | `#E0A054 → #B0762E` |
| rose | `#D0787A → #9A4448` |

Accent gradient used everywhere: `linear-gradient(135deg, #C2683E, #E0A054)`.

### Typography
- **Headings / serif**: `Newsreader` (Google), weight 500, often `font-style: italic` for emphasis spans. Optical sizes 6–72. Used for logo wordmark, page titles, story titles, stat numbers, section headings.
- **Body / UI**: `Hanken Grotesk` (Google), weights 400/500/600/700.
- **Alt heading option**: `Outfit` (Google) when "Sans" heading style is chosen.
- **Mono accents** (tiny labels like `photo · …`, drag handle): `ui-monospace, Menlo, monospace`.
- **Eyebrow labels**: 11px, `letter-spacing: .14em`, `text-transform: uppercase`.
- Type scale seen: hero h1 `clamp(42px,5.5vw,72px)`/line-height 1.03; page title 27px; section h2 24px; story title in reader 40px; card title 20–21px; body 14.5–18px; meta 12–13.5px.

Google Fonts import:
```
https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Outfit:wght@400;500;600;700&display=swap
```

### Spacing & radius
- Content padding: screens use `36–38px` horizontal, `30–36px` top.
- Card/panel padding: `24–28px`; hero banner `36px`.
- Grid gaps: `14–24px` (cards 22px, feature cards 24px).
- Radius scale: pills `100px`; buttons/inputs `10–13px`; panels/cards `15–22px`; covers `15–18px`; dialog `22px`; avatar `50%`.
- Max content width: `1200px` (marketing), reader column `760px`, settings `760px`.

### Shadows
- Panel: `0 10px 30px rgba(120,80,50,0.08)`
- Hover lift panel: `0 18px 40px rgba(120,80,50,0.14)`
- Accent button: `0 8px 20px rgba(194,104,62,0.30)`
- Cover spine: `0 16px 38px rgba(60,40,28,0.28)` + inset `0 0 0 1px rgba(255,255,255,0.18)`
- Dialog: `0 40px 80px rgba(60,40,28,0.28)`

### Motion (keyframes & transitions)
- `fadeUp` (0.4–0.7s ease): `opacity 0→1`, `translateY(18px)→0`, `scale(.985)→1`. Applied per screen and staggered on feature cards (`.15s/.25s/.35s`) and hero cover cards (`.2s/.35s/.5s`).
- `fadeIn` (0.2s): dialog backdrop.
- `floatA/B/C` (14–19s ease-in-out infinite): background orbs translate+scale.
- `cardFloat` (7–8s ease-in-out infinite): hero cover cards bob `translateY(-12px)`, preserving their base rotation via a `--rot` custom prop.
- `pulse` (2.5s ease-in-out infinite): status/connection dots fade `opacity 1→0.45`.
- Hover transitions: cards/tiles `transform .25–.28s` (lift `translateY(-3 to -6px)`); buttons `transform .2s` + `filter brightness(1.05)`; ~`.18–.2s` background fades on rows/nav.

---

## Screens / Views

### 1. Landing (`landing`)
**Purpose:** Public marketing page; entry to sign-in.
**Layout:** Centered `max-width:1200px`. Header row (logo left; nav links + "Sign in" glass button + "Start your story" accent button right). Hero is a 2-col grid `1.1fr 0.9fr`, gap 56px: left = eyebrow pill + serif h1 ("Every life is a / *library of moments.*" — second line is an accent-gradient text-clip italic span) + 18px subcopy + two CTAs; right = a 440px-tall stage with **three overlapping cover cards** rotated `-7°/+2°/+8°`, each floating (`cardFloat`). Then a 3-col feature card row, then a "Recently published" 4-up cover grid (`repeat(auto-fill,minmax(192px,1fr))`), then a footer.
**Key components:**
- Logo: 36px rounded-11px accent-gradient square with italic serif "M" + "Mémoire" wordmark.
- Eyebrow pill: glass, accent text, `border-radius:100px`, copy "A home for the stories worth keeping".
- CTAs: primary accent-gradient "Begin a story"; secondary glass "Browse published".
- Feature cards (3): accent-gradient icon chip (✦ / ◈ / ◎) + serif title + body. Titles: "Write & arrange", "Folders & collections", "Publish or keep private".

### 2. Login (`login`)
**Purpose:** Authenticate (mock — any click signs in).
**Layout:** Centered glass card `max-width:420px`, padding `42px 40px`, radius 24px, `blur(34px)`. Accent-gradient "M" tile, serif h1 "Welcome to Mémoire", subcopy, **Continue with Google** button (white glass + 22px conic-gradient Google dot), "or" divider, **Continue as guest** (fainter glass), fine print about Telegram storage, "← Back home" text button.
**Behavior:** Both buttons call sign-in → sets `authed:true`, `screen:dashboard`.

### 3. App shell (wraps screens 4–10)
- **Sidebar** (264px, sticky, full height, glass `0.55`/`blur(26px)`, right border): logo (→ dashboard); accent-gradient "+ New story" button (→ editor); nav list; bottom block = "Telegram storage connected" pill (pulsing dot), user row (EM avatar, name, "Storyteller · Admin" → profile), "Sign out".
  - **Nav items:** Dashboard · Folders & Collections · Favourites · Profile · Settings · Admin. Active item: ink text, weight 600, `background: rgba(194,104,62,0.12)`, accent-gradient dot; inactive: muted text, hollow-ring dot. (`reader` and `editor` keep "Dashboard" highlighted.)
- **Top bar** (sticky, glass `0.4`/`blur(24px)`, bottom border): serif page title (left) + search field (280px glass input, ⌕ glyph) + "+ New" accent button (right). Search filters by title/author/series/collection across the relevant lists, live on change.
- **Content area:** `flex:1; overflow:auto;` — each screen mounts here with a `fadeUp` entrance.

### 4. Dashboard (`dashboard`)
**Purpose:** Home; greet, continue, browse own + published stories.
**Layout:** Glass hero banner (radius 22px, internal accent radial glow top-right, `overflow:hidden`): eyebrow "GOOD AFTERNOON, ELEANOR", serif headline "You have 8 stories in your library — 5 are out in the world.", "Continue a story" accent button. Then "Your library" header (+ "Browse folders →" accent-text link) and a cover grid of the user's books. Then "Discover published stories" cover grid.
**Cover card (the workhorse component):** vertical flex, gap 12px, `cursor:pointer`, hover lifts `translateY(-6px)`. Inside: a 3:4 **cover spine** (theme gradient, padding 17px, space-between column) holding a top row (uppercase series eyebrow + circular heart fav button `rgba(0,0,0,0.22)` glass, ♥ when faved in `#FFD9C2` else ♡) and a bottom block (serif title + author). Below the spine: a status chip (colored dot + label) and/or right-aligned meta ("1,240 readers" or "Updated 2 days ago").

### 5. Folders & Collections (`folders`)
**Purpose:** Browse folders, drill into one, see its collections.
**Layout:** "Your folders" header + "+ New folder" glass button. Folder grid (`minmax(280px,1fr)`): each glass card shows serif folder name, "N stories · M collections", a Delete text button + "→", and a row of up to three mini 3:4 spine thumbnails (46px wide). Below: a breadcrumb (Folders / **open folder name**) + "+ New collection" button, then per-collection sections: eyebrow "COLLECTION" + serif name + Delete, then a cover grid (`minmax(178px,1fr)`) of that collection's books.
**Behavior:** Clicking a folder sets `openFolderId` (does not change screen). Delete folder/collection opens a confirm dialog.

### 6. Reader (`reader`)
**Purpose:** Read a published story.
**Layout:** `760px` centered column. "← Back to dashboard". Header row: 208px cover spine (left) + meta block (status chip, serif 40px title, italic serif blurb, "By {author} · {year} · {meta}", two buttons: glass "♡ Add to favourites" / "♥ In favourites" toggle + accent "Edit story" → editor). Then a vertical stack of **photo figures**: each is a 3:2 glass placeholder (`photo · {label}` in mono) + italic serif caption. Footer: "More from {author}" — a smaller cover grid (`minmax(158px,1fr)`, no status chip).

### 7. Editor (`editor`)
**Purpose:** Create/edit a story.
**Layout:** Top action row: "← Discard & close" + "Save draft" (glass) + "Publish story" (accent). Body is a 2-col grid `300px 1fr`:
- **Left rail:** "Cover" label + live cover spine preview + dashed "⤓ Replace cover image" button. "Visibility" label + three selectable cards (**Published / Private / Draft**, each title+desc; selected = accent border + `rgba(194,104,62,0.1)` fill). Telegram note pill. "Danger zone" → "Delete this story" (danger-tinted) opens confirm dialog.
- **Right column:** Glass panel with **Title** input (serif, 18px), **Description** textarea (3 rows), and Folder/Collection pseudo-selects (display-only ▾). Second glass panel "Photos & films": "+ Add media" button, "Drag the tiles to reorder." hint, and a grid (`minmax(148px,1fr)`) of **draggable media tiles** — each: 3:2 placeholder with an accent-gradient index badge (top-left), a red "×" remove (top-right), a ⠿ drag glyph, and a filename row. Plus a dashed "+ Add media" tile at the end.
**Behavior:** Title/description are controlled inputs (local edit state, fall back to the open book's values). Media tiles support HTML5 drag-and-drop reorder (`dragstart` records index; `drop` reorders); "×" removes; "+ Add media" appends "New photo". Visibility selection is local state.

### 8. Favourites (`favourites`)
**Purpose:** Saved stories.
**Layout:** Count line ("N stories saved to return to.") then a cover grid of faved books, OR an empty state (large ♡, serif "No favourites yet", hint) when none.

### 9. Profile (`profile`)
**Purpose:** Author profile + their stories.
**Layout:** Glass profile header (86px circular gradient avatar "EM", serif name, "@eleanor · Storyteller & Admin", bio, "Edit profile" button). A 4-up stat grid (glass cards: 8 Stories / 5 Published / 3 Folders / 5,520 Readers — serif numbers). "Your stories" cover grid.

### 10. Admin (`admin`)
**Purpose:** Overview table of all stories.
**Layout:** 4-up stat cards (Total stories / Published / Drafts & private / Total readers — computed from data). Telegram storage status pill ("3 channels · 248 files · 14.2 GB used", pulsing dot). A glass table: header row + body rows on a 6-col grid `2.4fr 1.4fr 1fr 1fr .9fr .8fr` (Story / Author / Folder / Status / Readers / Delete). Rows hover-highlight, click → reader; Delete → confirm dialog.

### 11. Settings (`settings`)
**Purpose:** Account, storage, danger zone.
**Layout:** `760px`. Three glass sections: **Account** (Display name input + "Signed in with" Google chip showing email). **Telegram storage** (description + "● Connected" status, 3 mini stat boxes Channels/Files/Used, "Reconnect bot" button). **Danger zone** (danger-bordered, "Sign out" + "Delete account").

### Dialog (overlay, any screen)
Fixed `rgba(60,40,28,0.28)` + `blur(6px)` backdrop (fades in). Centered glass card (`max-width:430px`, `blur(40px)`, radius 22px). Two kinds:
- **confirm** — serif title + body paragraph; confirm button is danger-gradient `#C8564A→#9A332A`, label "Delete".
- **create** — serif title + labelled text input (folder/collection name); confirm button is accent-gradient, label "Create".
Cancel button (glass) and clicking the backdrop both close. Card click is `stopPropagation`'d.

---

## Interactions & Behavior (summary)
- **Routing:** `go(screen)` swaps the active screen. Sign-in → dashboard; sign-out → landing.
- **Favourites:** `toggleFav(id)` adds/removes from a `favs` id array; heart icon + label reflect it. Seeded faved: ids 3 and 6.
- **Open story:** `openBook(id)` sets `openBookId` + `screen:reader`.
- **Folders:** `openFolder(id)` sets `openFolderId` (stays on folders screen). New folder cycles through a theme palette.
- **Editor media:** drag-reorder, remove, append (see screen 7).
- **Search:** single `query` string filters discover / your-books / favourites / admin / folder lists.
- **Deletes:** always routed through the confirm dialog before mutating the (in-memory) data arrays.
- All deletions/creations here mutate local arrays — **wire these to your real API/store**.

## State Management
Local component state (port to your store of choice — Zustand/Redux/Context, or server state via your data layer):
```
screen, authed, query,
openBookId, openFolderId,
favs: number[],
editorStatus: 'published'|'private'|'draft',
editTitle, editBlurb        // controlled editor fields (null = use book's value)
dialog: null | { kind:'confirm'|'create', title, body?, label?, confirmLabel, onYes?/onCreate? },
dialogInput: string,
editorImages: { id, label }[]   // reorderable media list
```
Data sources to replace with real fetching: the **books** list (id, title, author, series, collection, folder, status, theme, year, views, updated, blurb, photos[]) and the **folders** list (id, name, theme). Derived in render: filtered discover/your/fav lists, folder→collection grouping, admin stats, "more by author".

## Responsive behavior
Built for desktop (preview 1280×860). Several rows already use `flex-wrap` and `minmax(...,1fr)` auto-fill grids, so they reflow. For production add: collapse the 264px sidebar to a drawer under ~900px; stack the landing hero and editor 2-col grids to one column on narrow screens; let stat grids drop to 2-up.

## Assets
No external image assets — all imagery is represented by **gradient cover spines** and **glass placeholders** (`photo · {label}`). In production, replace cover spines with real cover images (keep the gradient as a fallback/overlay) and the reader/editor placeholders with actual media. Icons used are plain Unicode glyphs (✦ ◈ ◎ ⌕ ⠿ ♥ ♡ → × ▾ ⤓) — swap for your icon set (e.g. Lucide/Heroicons). The Google "G" is a CSS conic-gradient dot — replace with the real Google logo for production sign-in.

## Tweakable design props (in the prototype)
The prototype exposes four theme props you may want to surface as theming options: **accentFrom** / **accentTo** (accent gradient stops), **bgTint** (Cream/Linen/Blush), **headingStyle** (Serif `Newsreader` / Sans `Outfit`). Defaults: `#C2683E`, `#E0A054`, Cream, Serif.

## Files
- `Memoire v3.dc.html` — the full high-fidelity design reference (all screens, the app shell, the dialog, and all logic/dummy data). Open in a browser to view; read as source for any exact value not listed above. Ignore the `<x-dc>`, `support.js`, `{{ }}`, `<sc-if>`, `<sc-for>` runtime constructs — they are preview-only.
