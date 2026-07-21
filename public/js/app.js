'use strict';

// ── Theme gradients (mirror of lib/themes.js) for live cover preview ─────────
const THEMES = {
  terra: 'linear-gradient(140deg,#C2683E 0%,#8A3E22 100%)',
  sepia: 'linear-gradient(140deg,#9A6A3C 0%,#5A3414 100%)',
  olive: 'linear-gradient(140deg,#8A9A4E 0%,#4A5A22 100%)',
  blue:  'linear-gradient(140deg,#6E8794 0%,#3C5360 100%)',
  plum:  'linear-gradient(140deg,#A06A86 0%,#5A3450 100%)',
  ochre: 'linear-gradient(140deg,#D69A3A 0%,#9A6A14 100%)',
  slate: 'linear-gradient(140deg,#E0A054 0%,#B0762E 100%)',
  rose:  'linear-gradient(140deg,#D0787A 0%,#9A4448 100%)',
};

// ── Dialog overlay ──────────────────────────────────────────────────────────
function openDialog({ title, body, label, value, confirmLabel, danger, onConfirm, onCancel }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const isInput = typeof label === 'string';
  backdrop.innerHTML = `
    <div class="dialog-card" role="dialog" aria-modal="true">
      <h3>${escapeHtml(title || '')}</h3>
      ${body ? `<p>${escapeHtml(body)}</p>` : ''}
      ${isInput ? `<label class="field-label">${escapeHtml(label)}</label>
        <input class="input" type="text" placeholder="Name…" value="${escapeAttr(value || '')}">` : ''}
      <div class="dialog-actions">
        <button type="button" class="dialog-cancel">Cancel</button>
        <button type="button" class="dialog-confirm ${danger ? 'danger' : 'accent'}">${escapeHtml(confirmLabel || 'Confirm')}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const card = backdrop.querySelector('.dialog-card');
  const input = backdrop.querySelector('input');
  if (input) setTimeout(() => input.focus(), 30);

  function close(confirmed) {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (!confirmed && onCancel) onCancel(input ? input.value : undefined);
  }
  function confirm() {
    const val = input ? input.value.trim() : true;
    if (input && !val) { input.focus(); return; }
    close(true);
    onConfirm(val);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && input) confirm();
  }

  backdrop.addEventListener('click', () => close());
  card.addEventListener('click', (e) => e.stopPropagation());
  backdrop.querySelector('.dialog-cancel').addEventListener('click', () => close());
  backdrop.querySelector('.dialog-confirm').addEventListener('click', confirm);
  document.addEventListener('keydown', onKey);
}

function postForm(action, fields) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = action;
  Object.entries(fields || {}).forEach(([k, v]) => {
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = k; i.value = v;
    form.appendChild(i);
  });
  document.body.appendChild(form);
  showPageLoader();
  form.submit();
}

// ── Toast (reuses the .flash styling) ───────────────────────────────────────
// Returns a handle so a long action can update its message then dismiss it.
// timeout = 0 keeps it up until the caller calls done()/dismiss().
function showToast(message, type = 'info', timeout = 3200) {
  const el = document.createElement('div');
  el.className = 'flash ' + type;
  el.setAttribute('role', 'status');
  el.textContent = message;
  el.style.top = (18 + document.querySelectorAll('.flash').length * 56) + 'px';
  document.body.appendChild(el);
  const remove = () => {
    el.style.transition = 'opacity .4s ease, transform .4s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(-8px)';
    setTimeout(() => el.remove(), 420);
  };
  let timer = timeout ? setTimeout(remove, timeout) : null;
  return {
    update(msg, newType) { el.textContent = msg; if (newType) el.className = 'flash ' + newType; },
    done(msg, newType, after = 2600) { if (timer) clearTimeout(timer); this.update(msg, newType); timer = setTimeout(remove, after); },
    dismiss: remove,
  };
}

// Fetch a file and save it under its server-provided filename, resolving only
// once the whole file has arrived — so callers can show a "complete" toast (and
// a live % while it streams, when the server sends Content-Length).
async function saveDownload(url, opts, onProgress) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
  let name = 'download';
  if (m) { try { name = decodeURIComponent(m[1]); } catch (_) { name = m[1]; } }
  const total = Number(res.headers.get('Content-Length')) || 0;
  let blob;
  if (onProgress && total && res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received / total);
    }
    blob = new Blob(chunks);
  } else {
    blob = await res.blob();
  }
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
}

// ── Full-page loading overlay (initial load + between-page navigation) ──────
function showPageLoader() {
  const el = document.getElementById('pageLoader');
  if (el) el.classList.remove('hidden');
}
function hidePageLoader() {
  const el = document.getElementById('pageLoader');
  if (el) el.classList.add('hidden');
}
window.addEventListener('load', hidePageLoader);
setTimeout(hidePageLoader, 4000); // safety net if 'load' never fires
window.addEventListener('pageshow', (e) => { if (e.persisted) hidePageLoader(); }); // restored from bfcache

// Any normal same-origin link click or form submit navigates away from this
// page, so bring the loader back for the (server-rendered) page in transit.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
  if (samePage && url.hash) return; // in-page anchor jump, not a navigation
  showPageLoader();
});
document.addEventListener('submit', (e) => { if (!e.defaultPrevented) showPageLoader(); });

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

// ── Fast preview (admin-only switch on /settings) ────────────────────────────
// Off (the default, and everything a storyteller ever sees): tiles load as they
// near the viewport and the lightbox fetches the full-res original on click.
// On: the load-ahead window widens, small grids skip windowing altogether, the
// lightbox paints the tile's thumbnail on the click frame while the original
// downloads behind it, and neighbouring originals are prefetched so arrowing
// through a gallery never stalls.
const FAST_PREVIEW = document.body.dataset.fastPreview === '1';
// Even with fast preview on, a big set keeps its window: Safari holds every
// decoded bitmap, so mounting 500 photos at once crashes the tab (see the note
// on windowImages below). Below this many tiles the memory cost is safe.
const FAST_MOUNT_ALL_MAX = 150;

// ── Lightbox (full-size image viewer) ────────────────────────────────────────
// Full-screen image viewer. `items` is an array of { src, caption }; the
// viewer opens at `index` and can slide between images (buttons, arrow keys,
// swipe).
function openLightbox(items, index, onClose) {
  if (!Array.isArray(items)) items = [{ src: items, caption: arguments[1] || '' }]; // legacy single-arg
  let i = Math.max(0, Math.min(index || 0, items.length - 1));
  const multi = items.length > 1;

  const bd = document.createElement('div');
  bd.className = 'lightbox-backdrop';
  bd.innerHTML = `
    <button class="lightbox-close" aria-label="Close">×</button>
    <button class="lightbox-nav prev" aria-label="Previous image" ${multi ? '' : 'hidden'}>‹</button>
    <div class="lightbox-media"></div>
    <button class="lightbox-nav next" aria-label="Next image" ${multi ? '' : 'hidden'}>›</button>
    <div class="lightbox-cap"></div>
    <div class="lightbox-count" ${multi ? '' : 'hidden'}></div>`;
  document.body.appendChild(bd);
  document.body.style.overflow = 'hidden';

  const mediaEl = bd.querySelector('.lightbox-media');
  const capEl = bd.querySelector('.lightbox-cap');
  const countEl = bd.querySelector('.lightbox-count');

  // Fast preview: warm the originals on either side so arrowing through the
  // gallery doesn't wait on a download it could have started already.
  function prefetchNeighbours() {
    if (!FAST_PREVIEW || !multi) return;
    [-2, -1, 1, 2].forEach((d) => {
      const it = items[(i + d + items.length) % items.length];
      if (it && it.kind !== 'video') new Image().src = it.src;
    });
  }

  function render() {
    const it = items[i];
    if (it.kind === 'video') {
      mediaEl.innerHTML = `<video src="${it.src}" controls autoplay></video>`;
    } else if (FAST_PREVIEW && it.thumb && it.thumb !== it.src) {
      // The grid thumbnail is already decoded in this tab, so it paints on the
      // click frame — no spinner, no empty viewer. Swap in the full-res
      // original once it lands (same element, so there's no flash of nothing).
      mediaEl.innerHTML = `<img src="${it.thumb}" alt="">`;
      const shown = mediaEl.querySelector('img');
      const full = new Image();
      // Ignore a load that arrives after the viewer moved on to another image.
      full.onload = () => { if (shown.isConnected) shown.src = it.src; };
      full.src = it.src;
    } else {
      mediaEl.innerHTML = `<img src="${it.src}" alt="">`;
    }
    capEl.textContent = it.caption || '';
    capEl.style.display = it.caption ? '' : 'none';
    if (multi) countEl.textContent = `${i + 1} / ${items.length}`;
    prefetchNeighbours();
  }
  function go(d) { i = (i + d + items.length) % items.length; render(); }
  function close() {
    bd.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    // Tell the caller which image we ended on, so it can bring that one into
    // view (e.g. you paged 20 → 30 in the lightbox, then land back at 30).
    if (typeof onClose === 'function') onClose(i);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (multi && e.key === 'ArrowRight') go(1);
    else if (multi && e.key === 'ArrowLeft') go(-1);
  }

  bd.addEventListener('click', (e) => { if (e.target === bd) close(); }); // only the empty backdrop closes
  bd.querySelector('.lightbox-close').addEventListener('click', close);
  bd.querySelector('.prev').addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  bd.querySelector('.next').addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  document.addEventListener('keydown', onKey);

  // Touch swipe to change image.
  let sx = null;
  bd.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  bd.addEventListener('touchend', (e) => {
    if (sx == null || !multi) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    sx = null;
  });

  render();
}

// ── Wire up the page ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Card / row navigation via data-href (ignore clicks on inner controls).
  document.querySelectorAll('[data-href]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button, a, form, input, select, textarea, label')) return;
      window.location.href = el.dataset.href;
    });
  });

  // Heart / favourite toggle (AJAX, no reload).
  document.querySelectorAll('.heart-btn[data-fav-id]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = btn.dataset.favId;
      try {
        const res = await fetch(`/stories/${id}/favourite-ajax`, { method: 'POST', headers: { 'X-Requested-With': 'fetch' } });
        const data = await res.json();
        btn.classList.toggle('faved', data.faved);
        btn.textContent = data.faved ? '♥' : '♡';
        // Keep the visible like count in sync.
        const card = btn.closest('.cover-card');
        const likeEl = card && card.querySelector('.cover-likes');
        if (likeEl) {
          const cur = parseInt((likeEl.textContent.match(/\d+/) || ['0'])[0], 10) || 0;
          const next = Math.max(0, cur + (data.faved ? 1 : -1));
          likeEl.textContent = '♥ ' + next;
          likeEl.title = next + ' likes';
        }
      } catch (_) { /* ignore */ }
    });
  });

  // Notifications dropdown — toggle the panel, close on outside click / Escape.
  const notif = document.getElementById('notif');
  const notifBell = document.getElementById('notifBell');
  const notifPanel = document.getElementById('notifPanel');
  if (notif && notifBell && notifPanel) {
    const setOpen = (open) => {
      notifPanel.hidden = !open;
      notifBell.setAttribute('aria-expanded', open ? 'true' : 'false');
      notif.classList.toggle('open', open);
    };
    notifBell.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(notifPanel.hidden);
    });
    document.addEventListener('click', (e) => {
      if (!notif.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }

  // Flash toasts auto-dismiss after a few seconds.
  document.querySelectorAll('.flash').forEach((el, i) => {
    el.style.top = (18 + i * 56) + 'px';
    setTimeout(() => {
      el.style.transition = 'opacity .4s ease, transform .4s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(-8px)';
      setTimeout(() => el.remove(), 420);
    }, 3200 + i * 400);
  });

  // Confirm dialogs (delete actions).
  document.querySelectorAll('[data-confirm]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDialog({
        title: btn.dataset.title,
        body: btn.dataset.body,
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: () => {
          if (btn.dataset.action) { postForm(btn.dataset.action, {}); return; }
          const form = btn.closest('form');
          if (form) { showPageLoader(); form.submit(); }
        },
      });
    });
  });

  // Create dialogs (new folder / collection). When data-existing lists the
  // current names, a duplicate asks for confirmation first — declining goes
  // back to the name editor instead of saving.
  document.querySelectorAll('[data-create-dialog]').forEach((btn) => {
    let existing = [];
    try { existing = JSON.parse(btn.dataset.existing || '[]').map((n) => String(n).trim().toLowerCase()); } catch (_) { /* none */ }

    const openEditor = (initial) => openDialog({
      title: btn.dataset.title,
      label: btn.dataset.label || 'Name',
      value: initial || '',
      confirmLabel: 'Create',
      onConfirm: (val) => {
        if (existing.includes(val.trim().toLowerCase())) {
          openDialog({
            title: 'Name already exists',
            body: `You already have “${val}”. Do you want to continue and save another one with the same name?`,
            confirmLabel: 'Yes, continue',
            onConfirm: () => postForm(btn.dataset.action, { name: val }),
            onCancel: () => openEditor(val), // back to editing the name
          });
          return;
        }
        postForm(btn.dataset.action, { name: val });
      },
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openEditor();
    });
  });

  // Edit profile dialog.
  document.querySelectorAll('[data-edit-profile]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openDialog({
        title: 'Edit profile',
        label: 'Display name',
        value: btn.dataset.name,
        confirmLabel: 'Save',
        onConfirm: (name) => {
          openDialog({
            title: 'About you',
            label: 'Short bio',
            value: btn.dataset.bio,
            confirmLabel: 'Save',
            onConfirm: (bio) => postForm(btn.dataset.action, { name, bio }),
          });
        },
      });
    });
  });

  // Expandable description (reader) — clamp long text, reveal a Show more toggle
  // only when the text actually overflows the clamp.
  document.querySelectorAll('[data-expandable]').forEach((wrap) => {
    const text = wrap.querySelector('.blurb');
    const toggle = wrap.querySelector('.desc-toggle');
    if (!text || !toggle) return;
    if (text.scrollHeight - text.clientHeight > 2) toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const expanded = wrap.classList.toggle('expanded');
      toggle.textContent = expanded ? 'Show less' : 'Show more';
    });
  });

  // "New" / "Start writing" dropdowns — choose Story or Novel.
  document.querySelectorAll('.newmenu').forEach((menu) => {
    const btn = menu.querySelector('button');
    const pop = menu.querySelector('.newmenu-pop');
    if (!btn || !pop) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = pop.hidden;
      document.querySelectorAll('.newmenu-pop').forEach((p) => { p.hidden = true; });
      pop.hidden = !willOpen;
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  });
  document.addEventListener('click', () => document.querySelectorAll('.newmenu-pop').forEach((p) => { p.hidden = true; }));

  // Story composer — interleave text + image blocks, reorder, then serialize on save.
  const composer = document.getElementById('composer');
  if (composer) {
    const bookId = composer.dataset.book;
    const blocks = document.getElementById('blocks');
    const form = composer.closest('form');
    const contentField = document.getElementById('contentField');
    const imgInput = document.getElementById('composerImageInput');
    const progress = document.getElementById('composeUpload');
    const ctrl = '<div class="block-ctrl"><button type="button" data-up title="Move up">↑</button><button type="button" data-down title="Move down">↓</button><button type="button" data-del title="Remove">✕</button></div>';

    function makeText(value) {
      const el = document.createElement('div');
      el.className = 'block block-text';
      el.innerHTML = ctrl + '<textarea class="input block-text-input" rows="4" placeholder="Write a paragraph…"></textarea>';
      el.querySelector('textarea').value = value || '';
      return el;
    }
    function makeImage(mediaId, caption) {
      const el = document.createElement('div');
      el.className = 'block block-image';
      el.dataset.mediaId = mediaId;
      el.innerHTML = ctrl + `<img src="/media/${mediaId}" alt="">` + '<input class="input block-cap" placeholder="Caption (optional)">';
      el.querySelector('.block-cap').value = caption || '';
      return el;
    }

    blocks.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const block = e.target.closest('.block');
      if (!btn || !block) return;
      if (btn.hasAttribute('data-del')) block.remove();
      else if (btn.hasAttribute('data-up')) { const p = block.previousElementSibling; if (p) blocks.insertBefore(block, p); }
      else if (btn.hasAttribute('data-down')) { const n = block.nextElementSibling; if (n) blocks.insertBefore(n, block); }
    });

    document.getElementById('addTextBtn').addEventListener('click', () => {
      const b = makeText('');
      blocks.appendChild(b);
      const ta = b.querySelector('textarea'); if (ta) ta.focus();
    });
    document.getElementById('addImageBtn').addEventListener('click', () => imgInput.click());

    imgInput.addEventListener('change', async () => {
      const files = Array.from(imgInput.files || []);
      if (files.length) { progress.hidden = false; }
      for (let i = 0; i < files.length; i++) {
        progress.textContent = `Uploading ${i + 1}/${files.length}…`;
        try {
          let res;
          // Photos/videos go browser → Google Drive, bypassing the server.
          if (wantsDriveDirect(files[i])) {
            const df = await uploadToDrive(files[i]);
            res = await fetch(`/stories/${bookId}/media/register-drive`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ drive_id: df.id, file_name: files[i].name, mime: files[i].type, label: files[i].name.replace(/\.[^.]+$/, '') }),
            });
          } else {
            const fd = new FormData();
            fd.append('file', files[i]);
            res = await fetch(`/stories/${bookId}/media`, { method: 'POST', body: fd });
          }
          if (!res.ok) throw new Error('upload failed');
          const data = await res.json();
          const items = data.items || (data.id ? [data] : []);
          items.forEach((m) => blocks.appendChild(makeImage(m.id, '')));
        } catch (err) { /* skip failed file */ }
      }
      progress.hidden = true;
      imgInput.value = '';
    });

    form.addEventListener('submit', () => {
      const arr = [];
      blocks.querySelectorAll('.block').forEach((b) => {
        if (b.classList.contains('block-text')) {
          arr.push({ type: 'text', value: b.querySelector('textarea').value });
        } else if (b.classList.contains('block-image')) {
          arr.push({ type: 'image', mediaId: parseInt(b.dataset.mediaId, 10), caption: (b.querySelector('.block-cap') || {}).value || '' });
        }
      });
      contentField.value = JSON.stringify(arr);
    });
  }

  // Visibility cards (editor) — selection drives the save button's label/action.
  const saveBtn = document.getElementById('saveBtn');
  const SAVE_LABELS = { published: 'Publish story', private: 'Save privately' };
  document.querySelectorAll('[data-visibility]').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('[data-visibility]').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input[type=radio]');
      if (radio) {
        radio.checked = true;
        if (saveBtn) saveBtn.textContent = SAVE_LABELS[radio.value] || 'Save story';
      }
    });
  });

  // Live cover preview (editor).
  const titleInput = document.getElementById('titleInput');
  const coverTitle = document.getElementById('coverTitle');
  if (titleInput && coverTitle) {
    titleInput.addEventListener('input', () => { coverTitle.textContent = titleInput.value || 'Untitled'; });
  }

  // Duplicate story titles ask for confirmation before saving; declining
  // returns to the editor with the title focused for editing.
  const editorForm = document.getElementById('editorForm');
  if (editorForm && titleInput) {
    let existingTitles = [];
    try { existingTitles = JSON.parse(editorForm.dataset.existingTitles || '[]').map((t) => String(t).trim().toLowerCase()); } catch (_) { /* none */ }
    let confirmedDuplicate = false;
    editorForm.addEventListener('submit', (e) => {
      if (confirmedDuplicate) return;
      const val = (titleInput.value || '').trim();
      if (!val || !existingTitles.includes(val.toLowerCase())) return;
      e.preventDefault();
      openDialog({
        title: 'Story name already exists',
        body: `You already have a story named “${val}”. Do you want to continue and save it anyway?`,
        confirmLabel: 'Yes, continue',
        onConfirm: () => {
          confirmedDuplicate = true;
          if (editorForm.requestSubmit) editorForm.requestSubmit(); else editorForm.submit();
        },
        onCancel: () => titleInput.focus(),
      });
    });
  }
  const seriesInput = document.getElementById('seriesInput');
  const folderSelect = document.getElementById('folderSelect');
  const coverSeries = document.getElementById('coverSeries');
  function syncSeries() {
    // Series shown on the cover follows the folder name (matches the design's seeding).
    const txt = folderSelect && folderSelect.selectedOptions.length ? folderSelect.selectedOptions[0].text : '';
    if (coverSeries) coverSeries.textContent = txt === 'No folder' ? '' : txt;
    if (seriesInput) seriesInput.value = txt === 'No folder' ? '' : txt;
  }
  if (folderSelect) { folderSelect.addEventListener('change', syncSeries); }

  // Cover source control (upload / colour theme / first photo).
  initCover();

  // Media management (editor) — the story's own grid plus one per ending.
  initMedia();

  // Editor: alternate endings edited in place, without leaving the page.
  initEndingCards();

  // Standalone image gallery.
  initGallery();

  // Folder / collection tabs: one scrolling line, with an overflow hint.
  initTabStrips();

  // Library: view-only gallery photos merged into the folder tabs.
  initLibraryGallery();

  // Library: select several stories and fold them into one as its endings.
  initLibraryEndings();

  // Favourites page: favourited gallery photos (heart to remove, click to zoom).
  initFavouritesGallery();

  // Reader: grid/list layout toggle for a photo story's images.
  initReaderFigs();

  // Reader: fold sections away (remembered per story).
  initReaderSections();

  // Reader: swap between alternate endings without reloading the page.
  initEndingTabs();

  // Reader: keep only the photos near the viewport loaded (memory-bounded).
  initReaderFigWindow();

  // "Back" links return to the previous in-app page (the folder, library,
  // favourites, … you came from) rather than a fixed page. Referrer-Policy is
  // no-referrer, so the server can't know the origin — use history instead. The
  // href stays as a fallback for direct loads (no history) and no-JS.
  document.querySelectorAll('a[data-back]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (window.history.length > 1) { e.preventDefault(); window.history.back(); }
    });
  });

  // Folder view: per-folder story sorting (remembered per folder).
  initFolderSort();

  // Library: bulk folder import (1 folder = 1 private story).
  initFolderImport();

  // Library: import media straight into the gallery, assigned to a collection.
  initGalleryImport();

  // Library: sort mode — reload with ?sort= (the server remembers the choice).
  const librarySort = document.getElementById('librarySortSelect');
  if (librarySort) librarySort.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('sort', librarySort.value);
    url.searchParams.delete('page'); // a new sort starts from page 1
    window.location.href = url.toString();
  });

  // Live search — debounced auto-submit, with focus/caret restored after reload.
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  if (searchForm && searchInput) {
    if (searchInput.value) {
      searchInput.focus();
      const v = searchInput.value;
      searchInput.value = '';
      searchInput.value = v; // move caret to end
    }
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { showPageLoader(); searchForm.submit(); }, 350);
    });
  }

  // Mobile sidebar drawer — dimmed overlay + auto-close on nav / outside / Esc.
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  if (menuToggle && sidebar) {
    let overlay = null;
    const closeSidebar = () => {
      sidebar.classList.remove('open');
      if (overlay) { overlay.remove(); overlay = null; }
    };
    const openSidebar = () => {
      sidebar.classList.add('open');
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.addEventListener('click', closeSidebar);
      // Insert in the sidebar's own stacking context so the sidebar (z-index:40)
      // stays clickable above the overlay (z-index:39); appending to <body>
      // would put it in the root context, on top of the whole sidebar.
      sidebar.parentNode.insertBefore(overlay, sidebar);
    };
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
    });
    sidebar.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeSidebar));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
  }

  // Profile photo picker + live preview (edit profile page).
  const avatarBtn = document.getElementById('avatarBtn');
  const avatarInput = document.getElementById('avatarInput');
  const avatarPreview = document.getElementById('avatarPreview');
  if (avatarBtn && avatarInput) {
    avatarBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', () => {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file || !avatarPreview) return;
      const url = URL.createObjectURL(file);
      avatarPreview.textContent = '';
      avatarPreview.style.backgroundImage = `url(${url})`;
      avatarPreview.style.backgroundSize = 'cover';
      avatarPreview.style.backgroundPosition = 'center';
    });
  }

  // Auto-submit selects (e.g. moving a folder into a collection).
  document.querySelectorAll('select[data-autosubmit]').forEach((sel) => {
    sel.addEventListener('change', () => { if (sel.form) { showPageLoader(); sel.form.submit(); } });
  });

  // Reader: click a story photo to view it full-size, then slide between all
  // the story's images.
  const figImgs = Array.from(document.querySelectorAll('.reader-figs .photo-frame img, .story-body img'));
  if (figImgs.length) {
    // Built per click, not once up front: windowing mounts and unmounts tiles as
    // you scroll, so `thumb` is only accurate at the moment you open the viewer.
    const galleryNow = () => figImgs.map((img) => {
      const fig = img.closest('figure');
      const fc = fig && fig.querySelector('figcaption');
      // Tiles load a downscaled ?w= preview; the lightbox opens the full-res
      // original (data-full) so only the one on screen is decoded at full size.
      // `thumb` is whatever this tile has loaded right now — fast preview paints
      // it instantly while the original downloads (empty for unmounted tiles).
      return {
        src: img.dataset.full || img.getAttribute('src'),
        thumb: img.currentSrc || img.getAttribute('src') || '',
        caption: ((fc && fc.textContent) || '').trim(),
      };
    });
    figImgs.forEach((img, idx) => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => openLightbox(galleryNow(), idx, (end) => {
        if (figImgs[end]) figImgs[end].scrollIntoView({ block: 'center' });
      }));
    });
  }

  // Auto-dismiss flash messages.
  document.querySelectorAll('.flash').forEach((f) => {
    setTimeout(() => { f.style.transition = 'opacity .4s'; f.style.opacity = '0'; setTimeout(() => f.remove(), 400); }, 3200);
  });
});

// ── Editor cover: upload image / colour theme / first photo ─────────────────
function imgBg(url) {
  return `linear-gradient(180deg,rgba(0,0,0,0.35) 0%,rgba(0,0,0,0.12) 42%,rgba(0,0,0,0.62) 100%), url(${url}) center/cover no-repeat`;
}

function initCover() {
  const preview = document.getElementById('coverPreview');
  if (!preview) return;
  const themeSelect = document.getElementById('themeSelect');
  const coverInput = document.getElementById('coverInput');
  const coverUploadBtn = document.getElementById('coverUploadBtn');
  const grid = document.getElementById('mediaGrid');

  const themeBg = () => THEMES[themeSelect ? themeSelect.value : 'terra'] || THEMES.terra;
  const firstPhotoUrl = () => {
    const img = grid && grid.querySelector('.media-tile img');
    return img ? img.getAttribute('src') : null;
  };

  function setImage(url) { preview.classList.add('has-image'); preview.style.background = imgBg(url); }
  function setTheme() { preview.classList.remove('has-image'); preview.style.background = themeBg(); }

  function applyMode(mode) {
    document.querySelectorAll('[data-cover-panel]').forEach((p) => { p.hidden = p.dataset.coverPanel !== mode; });
    document.querySelectorAll('#coverModes .cover-mode').forEach((l) => {
      const r = l.querySelector('input');
      l.classList.toggle('selected', !!(r && r.value === mode));
    });
    if (mode === 'upload') {
      if (preview.dataset.coverUrl) setImage(preview.dataset.coverUrl); else setTheme();
    } else if (mode === 'first') {
      const url = firstPhotoUrl();
      if (url) setImage(url); else setTheme();
    } else {
      setTheme();
    }
  }

  function currentMode() {
    const c = document.querySelector('#coverModes input[name=cover_mode]:checked');
    return c ? c.value : 'theme';
  }

  document.querySelectorAll('#coverModes .cover-mode').forEach((label) => {
    label.addEventListener('click', () => {
      const r = label.querySelector('input');
      if (r) { r.checked = true; applyMode(r.value); }
    });
  });

  if (themeSelect) {
    themeSelect.addEventListener('change', () => { if (currentMode() === 'theme') setTheme(); });
  }

  if (coverUploadBtn && coverInput) {
    if (preview.dataset.coverUrl) coverUploadBtn.textContent = '⤓ Replace cover image';
    coverUploadBtn.addEventListener('click', () => coverInput.click());
    coverInput.addEventListener('change', async () => {
      const file = coverInput.files && coverInput.files[0];
      if (!file) return;
      const original = coverUploadBtn.innerHTML;
      coverUploadBtn.disabled = true;
      coverUploadBtn.innerHTML = '<span class="spinner spinner-sm"></span>Uploading…';
      const book = coverUploadBtn.dataset.book;
      try {
        let res;
        // Cover photos go browser → Google Drive, bypassing the server.
        if (wantsDriveDirect(file)) {
          const df = await uploadToDrive(file);
          res = await fetch(`/stories/${book}/cover/register-drive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ drive_id: df.id, file_name: file.name, mime: file.type }),
          });
        } else {
          const fd = new FormData();
          fd.append('cover', file);
          res = await fetch(`/stories/${book}/cover`, { method: 'POST', body: fd });
        }
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        preview.dataset.coverUrl = data.url;
        const up = document.querySelector('#coverModes input[value=upload]');
        if (up) up.checked = true;
        applyMode('upload');
        coverUploadBtn.disabled = false;
        coverUploadBtn.innerHTML = '⤓ Replace cover image';
      } catch (err) {
        coverUploadBtn.disabled = false;
        coverUploadBtn.innerHTML = 'Upload failed — try again';
        setTimeout(() => { coverUploadBtn.innerHTML = original; }, 2500);
      }
      coverInput.value = '';
    });
  }
}

// ── Batch-upload time estimate ───────────────────────────────────────────────
// Each file makes two hops (browser → server → storage). Live XHR progress
// tells us how many bytes have left the browser; those count half until the
// server confirms the file is stored (full credit), since the second hop is
// still pending. Rate = credited bytes / elapsed. The readout is smoothed so
// it counts down steadily instead of jumping around.
function makeUploadEta(files) {
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const start = Date.now();
  let doneBytes = 0;
  let smoothed = null;
  const inflight = new Map(); // file → bytes sent so far
  return {
    progress(file, sentBytes) { inflight.set(file, Math.min(sentBytes, file.size || sentBytes)); },
    fileDone(file) { inflight.delete(file); doneBytes += (file.size || 0); },
    text() {
      const elapsed = (Date.now() - start) / 1000;
      let sent = 0;
      inflight.forEach((b) => { sent += b; });
      // Sent-but-unconfirmed bytes count 70%: the browser→server hop (what we
      // can measure) is normally the slow one; the server→storage hop behind
      // it rides datacenter bandwidth.
      const credited = doneBytes + sent * 0.7;
      if (!credited || !totalBytes || elapsed < 1.5) return 'estimating time…';
      const raw = (totalBytes - credited) / (credited / elapsed);
      smoothed = smoothed === null ? raw : (smoothed + raw) / 2;
      return `about ${formatDuration(smoothed)} left`;
    },
  };
}

// ── Browser-direct Google Drive uploads ──────────────────────────────────────
// Photos and videos upload straight to Google, bypassing this server: the
// server mints a resumable session URL (bound to this origin for CORS), the
// browser PUTs the bytes to Google with progress, then registers the file id
// with the app. This keeps upload traffic off the host's metered bandwidth.
// (PDFs/other files still relay through the server so they keep Telegram's
// document handling — they're small and rare.)
function wantsDriveDirect(file) {
  if (document.body.dataset.driveDirect !== '1') return false;
  const t = file.type || '';
  return t.startsWith('image/') || t.startsWith('video/');
}

async function uploadToDrive(file, onProgress) {
  const sess = await fetch('/drive/upload-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: file.name, mime: file.type, size: file.size }),
  });
  if (!sess.ok) {
    let msg = 'Could not start the Drive upload';
    try { msg = (await sess.json()).error || msg; } catch (_) { /* non-JSON */ }
    throw new Error(msg);
  }
  const { url } = await sess.json();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    if (xhr.upload && onProgress) {
      xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded); });
    }
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } // { id, size }
        catch (_) { reject(new Error('Unexpected response from Google Drive')); }
      } else {
        reject(new Error('Drive upload failed (HTTP ' + xhr.status + ')'));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during the Drive upload')));
    xhr.send(file);
  });
}

// When an upload batch finishes, ask the server to record a bell notification
// ("N photos added to …"), then drop it into the bell live so the user sees it
// without a refresh. The server keeps the persistent copy for later loads.
function notifyUploadComplete(url, count) {
  if (!count || count <= 0) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d && d.notification) bumpBell(d.notification.message, d.notification.href); })
    .catch(() => { /* the notification is still saved server-side */ });
}

// Live-update the notification bell: bump the unread badge and prepend an item,
// matching the server-rendered markup so it looks identical after a reload.
function bumpBell(message, href) {
  const bell = document.getElementById('notifBell');
  if (bell) {
    let badge = bell.querySelector('.notif-badge');
    if (!badge) { badge = document.createElement('span'); badge.className = 'notif-badge'; bell.appendChild(badge); }
    const cur = parseInt(badge.textContent, 10) || 0;
    badge.textContent = cur + 1 > 9 ? '9+' : String(cur + 1);
  }
  const list = document.querySelector('.notif-list');
  if (list) {
    const empty = list.querySelector('.notif-empty');
    if (empty) empty.remove();
    const a = document.createElement('a');
    a.className = 'notif-item unread';
    a.href = href || '#';
    a.innerHTML = '<span class="notif-ic upload">🖼️</span><span class="notif-body">'
      + '<span class="notif-text"></span><span class="notif-time">just now</span></span>';
    a.querySelector('.notif-text').textContent = message;
    list.insertBefore(a, list.firstChild);
  }
}

// POST a FormData like fetch(), but report upload progress along the way.
// Resolves to a fetch-Response-alike ({ ok, status, json }).
function postFormWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (xhr.upload && onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded);
      });
    }
    xhr.addEventListener('load', () => resolve({
      ok: xhr.status >= 200 && xhr.status < 300,
      status: xhr.status,
      json: async () => JSON.parse(xhr.responseText),
    }));
    xhr.addEventListener('error', () => reject(new Error('network error')));
    xhr.addEventListener('abort', () => reject(new Error('upload cancelled')));
    xhr.send(formData);
  });
}

// Recursively gather File objects from a drag-and-drop directory entry.
// (The entries API reads dropped folders directly, with no browser prompt.)
function readEntryFiles(entry) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((f) => resolve([f]), () => resolve([]));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const acc = [];
      const readBatch = () => reader.readEntries(async (batch) => {
        if (!batch.length) {
          const nested = await Promise.all(acc.map(readEntryFiles));
          resolve(nested.flat());
        } else {
          acc.push(...batch);
          readBatch(); // readEntries yields ~100 at a time; keep going
        }
      }, () => resolve([]));
      readBatch();
    } else {
      resolve([]);
    }
  });
}

// One level down a dropped folder: the files sitting directly inside it, and
// each direct sub-folder flattened into its own bundle. That shape is what lets
// "a folder of two folders" become one story with two endings — a fully
// recursive read would lose the boundary between them.
function readDirShallow(entry) {
  return new Promise((resolve) => {
    const reader = entry.createReader();
    const acc = [];
    const readBatch = () => reader.readEntries(async (batch) => {
      if (batch.length) { acc.push(...batch); readBatch(); return; }
      const files = [];
      const subs = [];
      for (const en of acc) {
        if (en.isFile) {
          const [f] = await readEntryFiles(en);
          if (f) files.push(f);
        } else if (en.isDirectory) {
          subs.push({ name: en.name, files: await readEntryFiles(en) });
        }
      }
      resolve({ files, subs });
    }, () => resolve({ files: [], subs: [] }));
    readBatch();
  });
}

// Recursively gather File objects from a File System Access directory handle
// (nested folders included, mirroring the drag-and-drop path).
async function collectDirFiles(dirHandle) {
  const out = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      try { out.push(await entry.getFile()); } catch (_) { /* unreadable file */ }
    } else if (entry.kind === 'directory') {
      out.push(...await collectDirFiles(entry));
    }
  }
  return out;
}

// ── Library: bulk folder import — 1 folder = 1 private story ────────────────
function initFolderImport() {
  const btn = document.getElementById('importFoldersBtn');
  if (!btn) return;
  const input = document.getElementById('importFolderInput');
  const zone = document.getElementById('importDropzone');
  const progress = document.getElementById('importProgress');

  function show(text) {
    if (!progress) return;
    progress.hidden = !text;
    progress.textContent = text || '';
  }

  const isMedia = (f) => /^(image|video)\//.test(f.type || '');
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

  // Keep only photo/video files, sort everything by name, drop empty folders.
  // `subs` (direct sub-folders) are normalised the same way and kept alongside
  // the loose files — how they become stories is decided at import time.
  function normalizeGroups(groups) {
    return groups
      .map((g) => ({
        name: g.name,
        files: (g.files || []).filter(isMedia).sort(byName),
        subs: (g.subs || [])
          .map((s) => ({ name: s.name, files: (s.files || []).filter(isMedia).sort(byName) }))
          .filter((s) => s.files.length)
          .sort(byName),
      }))
      .filter((g) => g.files.length || g.subs.length)
      .sort(byName);
  }

  // A nested folder becomes one story plus its endings: loose files at the top
  // are the story's own photos, and every sub-folder becomes an ending shown
  // below them. A folder holding nothing but sub-folders makes a story with no
  // photos of its own — just its endings.
  function toStoryPlan(g) {
    return { name: g.name, files: g.files, label: null, endings: g.subs };
  }

  // "Separate stories" mode: the same tree, flattened the way it used to import
  // — every sub-folder its own story, loose files a story named after the parent.
  function toSeparateStories(g) {
    if (!g.subs.length) return [{ name: g.name, files: g.files, label: null, endings: [] }];
    const out = g.files.length ? [{ name: g.name, files: g.files, label: null, endings: [] }] : [];
    g.subs.forEach((s) => out.push({ name: s.name, files: s.files, label: null, endings: [] }));
    return out;
  }

  // The user's app folders (for the "add to folder" dropdown), embedded by the
  // library view as JSON.
  function appFolders() {
    const el = document.getElementById('importFoldersData');
    try { return el ? JSON.parse(el.textContent) : []; } catch (_) { return []; }
  }

  // The one import dialog. It holds a running list of folders to import: you
  // keep adding folders (Add folder… opens the picker, or drop them in) — since
  // no browser lets you multi-select folders in one dialog, you build the list
  // up here — then Import turns each into its own private story. Only one
  // dialog exists at a time; opening again while it's up just adds to the list.
  let dlg = null; // { pending: [{name, files}], root: element, rerender, addGroups }

  function openImportDialog(seedGroups) {
    if (dlg) { if (seedGroups) dlg.addGroups(seedGroups); return; }

    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const folderOptions = ['<option value="">No folder</option>']
      .concat(appFolders().map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`))
      .join('');
    backdrop.innerHTML = `
      <div class="dialog-card" role="dialog" aria-modal="true">
        <h3>Import folders</h3>
        <p>Add each folder you want to import — every folder becomes its own private story, named after the folder, with its first photo as the cover.</p>
        <div id="importDropTarget" style="border:2px dashed rgba(140,100,60,.45);border-radius:12px;padding:22px 16px;margin:0 0 4px;text-align:center;font-size:13px;opacity:.85;cursor:pointer;">
          Drop folders here, or <span style="text-decoration:underline;">click to add a folder</span>
        </div>
        <div id="importList" style="max-height:230px;overflow:auto;margin:10px 0 20px;"></div>
        <div id="importNestRow" hidden style="margin:4px 0 14px;">
          <label class="field-label" style="font-size:12px;">Folders inside a folder become</label>
          <div class="sort-toggle" id="importNestMode" style="width:100%;">
            <a href="#" data-mode="endings" class="active">Endings of one story</a>
            <a href="#" data-mode="stories">Separate stories</a>
          </div>
        </div>
        <label class="field-label" for="importIntoFolder" style="font-size:12px;">Add the new stories to</label>
        <select class="pseudo-select" id="importIntoFolder" style="width:100%;cursor:pointer;">${folderOptions}</select>
        <div class="dialog-actions">
          <button type="button" class="dialog-cancel">Cancel</button>
          <button type="button" class="dialog-confirm accent" id="importGo" disabled>Import</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const card = backdrop.querySelector('.dialog-card');
    const target = backdrop.querySelector('#importDropTarget');
    const list = backdrop.querySelector('#importList');
    const goBtn = backdrop.querySelector('#importGo');
    const nestRow = backdrop.querySelector('#importNestRow');
    const pending = [];
    let nestMode = 'endings'; // how sub-folders import: 'endings' | 'stories'

    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); dlg = null; };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    // How many stories the current list will actually create, and how each
    // folder breaks down — a nested folder reads "1 story · 2 endings".
    function plansFor(g) { return nestMode === 'endings' ? [toStoryPlan(g)] : toSeparateStories(g); }
    function countFiles(g) { return g.files.length + g.subs.reduce((n, s) => n + s.files.length, 0); }

    function rerender() {
      const nested = pending.some((g) => g.subs.length);
      nestRow.hidden = !nested;
      if (!pending.length) {
        list.innerHTML = '<div style="opacity:.55;font-size:13px;padding:6px 2px;">No folders added yet.</div>';
      } else {
        list.innerHTML = pending.map((g, i) => {
          const plans = plansFor(g);
          const endings = plans.reduce((n, p) => n + p.endings.length, 0);
          const shape = plans.length > 1
            ? `${plans.length} stories`
            : (endings ? `1 story · ${endings} ending${endings === 1 ? '' : 's'}` : '1 story');
          return `
          <div style="display:flex;align-items:center;gap:10px;padding:7px 2px;">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.name)}</span>
            <span style="opacity:.6;font-size:12px;flex-shrink:0;">${countFiles(g)} file${countFiles(g) === 1 ? '' : 's'} · ${shape}</span>
            <button type="button" data-rm="${i}" title="Remove" style="border:none;background:none;cursor:pointer;font-size:16px;opacity:.6;line-height:1;">×</button>
          </div>`;
        }).join('');
      }
      const stories = pending.reduce((n, g) => n + plansFor(g).length, 0);
      goBtn.disabled = !pending.length;
      goBtn.textContent = stories ? `Import ${stories} ${stories === 1 ? 'story' : 'stories'}` : 'Import';
    }

    // Add folders, keeping only those with media and skipping duplicates (by
    // name) already in the list.
    function addGroups(groups) {
      const clean = normalizeGroups(groups);
      let added = 0;
      for (const g of clean) {
        if (pending.some((p) => p.name === g.name)) continue;
        pending.push(g);
        added += 1;
      }
      rerender();
      if (!added && clean.length === 0) flashTarget('No photos or videos in there');
    }

    let flashTimer = null;
    function flashTarget(msg) {
      target.dataset.msg = target.dataset.msg || target.textContent;
      target.textContent = msg;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { target.innerHTML = 'Drop folders here, or <span style="text-decoration:underline;">click to add a folder</span>'; }, 2500);
    }

    list.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { pending.splice(Number(rm.dataset.rm), 1); rerender(); }
    });

    backdrop.querySelector('#importNestMode').addEventListener('click', (e) => {
      const a = e.target.closest('[data-mode]');
      if (!a) return;
      e.preventDefault();
      nestMode = a.dataset.mode;
      backdrop.querySelectorAll('#importNestMode a').forEach((el) => el.classList.toggle('active', el === a));
      rerender();
    });

    target.addEventListener('click', async () => { const g = await pickFolderGroups(); if (g) addGroups(g); });
    target.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; target.classList.add('drop-active'); });
    target.addEventListener('dragleave', () => target.classList.remove('drop-active'));
    target.addEventListener('drop', async (e) => {
      e.preventDefault();
      target.classList.remove('drop-active');
      const g = await groupsFromDrop(e);
      if (g) addGroups(g);
    });

    backdrop.addEventListener('click', close);
    card.addEventListener('click', (e) => e.stopPropagation());
    backdrop.querySelector('.dialog-cancel').addEventListener('click', close);
    goBtn.addEventListener('click', async () => {
      if (!pending.length) return;
      const folderId = backdrop.querySelector('#importIntoFolder').value || null;
      const plans = pending.flatMap(plansFor);
      close();
      await importGroups(plans, folderId);
    });
    document.addEventListener('keydown', onKey);

    dlg = { pending, addGroups };
    rerender();
    if (seedGroups) addGroups(seedGroups);
  }

  // Kept name for existing drop callers — funnel into the accumulating dialog.
  function confirmAndImport(groups) { openImportDialog(groups); }

  // plans: [{ name, files, label, endings: [{name, files}] }] — each plan makes
  // one private story named after the folder (files in name order, first photo
  // as the cover, filed into the chosen app folder), plus one extra story per
  // ending, attached to it and hidden from the library.
  async function importGroups(plans, folderId) {
    const allFiles = plans.flatMap((p) => p.files.concat(p.endings.flatMap((e) => e.files)));
    const eta = makeUploadEta(allFiles);
    let storyNo = 0;
    let storiesDone = 0, photosDone = 0; // totals for the completion notification
    const label = () => `Importing story ${storyNo}/${plans.length} · ${eta.text()}…`;
    const ticker = setInterval(() => show(label()), 1000);

    // Create one story and fill it. `parentId` set makes it an alternate ending
    // of that story instead of a library entry of its own. Returns its id, or
    // null if it could not be created (its files are still marked done so the
    // ETA stays honest).
    async function makeStory({ title, files, endingLabel, parentId }) {
      let id = null;
      try {
        const createRes = await fetch('/stories/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            folder_id: parentId ? null : folderId, // endings aren't filed on their own
            parent_id: parentId || null,
            ending_label: endingLabel || null,
          }),
        });
        if (createRes.ok) id = (await createRes.json()).id;
      } catch (_) { /* fall through */ }
      if (!id) { files.forEach((f) => eta.fileDone(f)); return null; }

      // Upload the folder's files, a couple at a time, remembering each media id.
      const ids = new Array(files.length).fill(null);
      const queue = files.map((file, idx) => ({ file, idx }));
      const worker = async () => {
        for (let it = queue.shift(); it; it = queue.shift()) {
          try {
            let res;
            // Photos/videos go browser → Google Drive (bypass the server);
            // anything else relays through the server as before.
            if (wantsDriveDirect(it.file)) {
              const df = await uploadToDrive(it.file, (sent) => eta.progress(it.file, sent));
              res = await fetch(`/stories/${id}/media/register-drive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  drive_id: df.id,
                  file_name: it.file.name,
                  mime: it.file.type,
                  label: it.file.name.replace(/\.[^.]+$/, ''),
                }),
              });
            } else {
              const fd = new FormData();
              fd.append('file', it.file);
              fd.append('label', it.file.name.replace(/\.[^.]+$/, ''));
              res = await postFormWithProgress(`/stories/${id}/media`, fd, (sent) => eta.progress(it.file, sent));
            }
            if (res.ok) {
              const item = ((await res.json()).items || [])[0];
              if (item) ids[it.idx] = item.id;
            }
          } catch (_) { /* skip failed file */ }
          eta.fileDone(it.file);
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));

      // Uploads finish out of order — persist the by-name order.
      const order = ids.filter((x) => x != null);
      photosDone += order.length;
      if (order.length > 1) {
        await fetch(`/stories/${id}/media/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order }),
        }).catch(() => {});
      }
      return id;
    }

    try {
      for (const p of plans) {
        storyNo += 1;
        show(label());
        const parentId = await makeStory({ title: p.name, files: p.files, endingLabel: p.label });
        if (!parentId) {
          // The story failed — its endings have nothing to hang off, so skip them.
          p.endings.forEach((e) => e.files.forEach((f) => eta.fileDone(f)));
          continue;
        }
        storiesDone += 1;
        for (const e of p.endings) {
          await makeStory({ title: e.name, files: e.files, endingLabel: e.name, parentId });
        }
      }
    } finally {
      clearInterval(ticker);
    }
    show('');
    // Record a bell notification summarising the import (like media uploads).
    // The page reloads next, so the persisted notification shows in the bell.
    if (storiesDone > 0) {
      try {
        await fetch('/stories/import/notify-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stories: storiesDone, photos: photosDone, folder_id: folderId }),
        });
      } catch (_) { /* best-effort; nothing to show if it fails */ }
    }
    location.reload(); // show the new stories
  }

  // Pull folder groups out of a drag-and-drop event: each dropped folder =
  // one group. Returns null when nothing droppable was there.
  async function groupsFromDrop(e) {
    const entries = Array.from(e.dataTransfer.items || [])
      .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter((en) => en && en.isDirectory);
    if (!entries.length) return null;
    const groups = [];
    for (const d of entries) {
      const { files, subs } = await readDirShallow(d);
      groups.push({ name: d.name, files, subs });
    }
    return groups;
  }

  // Open the system folder picker for ONE folder and return its groups:
  // its subfolders each become a group, and loose files right inside it
  // become one group named after the folder itself. Returns null on cancel.
  // (The browser shows its own folder-access confirmation here — unavoidable
  // for browsing; drag-and-drop avoids it.)
  let pendingPickerResolve = null;
  async function pickFolderGroups() {
    if (!window.showDirectoryPicker) {
      // No File System Access API — fall back to <input webkitdirectory>, which
      // resolves asynchronously via its change handler below.
      if (!input) return null;
      return new Promise((resolve) => { pendingPickerResolve = resolve; input.click(); });
    }
    let dir;
    try {
      dir = await window.showDirectoryPicker();
    } catch (err) {
      if (err && err.name === 'AbortError') return null; // user cancelled
      if (!input) return null;
      return new Promise((resolve) => { pendingPickerResolve = resolve; input.click(); });
    }
    // One group for the picked folder, its sub-folders kept separate so they can
    // become endings (or separate stories — the dialog decides).
    const subs = [];
    const loose = [];
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') subs.push({ name: entry.name, files: await collectDirFiles(entry) });
      else { try { loose.push(await entry.getFile()); } catch (_) { /* unreadable */ } }
    }
    return [{ name: dir.name, files: loose, subs }];
  }

  // Button → open the accumulating import dialog.
  btn.addEventListener('click', () => openImportDialog());

  // Fallback <input webkitdirectory>: picks one parent folder; group each file
  // by the subfolder it sits in ("Parent/Sub/x.png" → "Sub"; files right inside
  // the parent group under the parent's name). Result goes back to whoever is
  // awaiting the picker, or opens the dialog directly.
  if (input) {
    input.addEventListener('change', async () => {
      // "Parent/Sub/x.png" → a sub-folder of the picked parent; "Parent/x.png" →
      // loose inside it. Same one-group-with-subs shape as the other pickers.
      const files = Array.from(input.files || []);
      const rootName = ((files[0] || {}).webkitRelativePath || '').split('/')[0] || 'Import';
      const loose = [];
      const map = new Map();
      for (const f of files) {
        const seg = (f.webkitRelativePath || f.name).split('/').filter(Boolean);
        if (seg.length > 2) {
          if (!map.has(seg[1])) map.set(seg[1], []);
          map.get(seg[1]).push(f);
        } else {
          loose.push(f);
        }
      }
      const groups = [{ name: rootName, files: loose, subs: [...map.entries()].map(([name, fs]) => ({ name, files: fs })) }];
      input.value = '';
      if (pendingPickerResolve) { const r = pendingPickerResolve; pendingPickerResolve = null; r(groups); }
      else openImportDialog(groups); // input used directly (no dialog awaiting)
    });
  }

  // Drag & drop: each dropped folder becomes a story (no prompt at all).
  if (zone) {
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    zone.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      zone.classList.add('drop-active');
    });
    zone.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) zone.classList.remove('drop-active');
    });
    zone.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      zone.classList.remove('drop-active');
      const groups = await groupsFromDrop(e);
      if (!groups) return;
      show('Reading folders…');
      await confirmAndImport(groups);
    });
  }
}

// ── Library: import media straight into the gallery, assigned to a collection ──
// A sibling to the folder import: pick photos/videos, choose a collection to
// file them under (or none), and they upload to the gallery like a normal
// gallery upload — then the library reloads to show them.
function initGalleryImport() {
  const btn = document.getElementById('importGalleryBtn');
  if (!btn) return;
  const input = document.getElementById('importGalleryInput');
  const progress = document.getElementById('importProgress');

  function collections() {
    const el = document.getElementById('importCollectionsData');
    try { return el ? JSON.parse(el.textContent) : []; } catch (_) { return []; }
  }

  function show(text) {
    if (!progress) return;
    progress.hidden = !text;
    progress.textContent = text || '';
  }

  // Ask which collection to file the imported media under. Resolves to the
  // chosen collection id ('' = no collection), or null if the user cancels.
  function pickCollection(count) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'dialog-backdrop';
      const opts = collections().concat([{ id: '', name: 'No collection' }]);
      backdrop.innerHTML =
        '<div class="dialog-card" role="dialog" aria-modal="true">' +
        `<h3>Add ${count} ${count === 1 ? 'item' : 'items'} to…</h3>` +
        '<div class="chooser">' +
        opts.map((c) => `<button type="button" class="chooser-opt" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join('') +
        '</div><div class="dialog-actions"><button type="button" class="dialog-cancel">Cancel</button></div></div>';
      document.body.appendChild(backdrop);
      let done = false;
      const close = (val) => { if (done) return; done = true; backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      backdrop.addEventListener('click', () => close(null));
      backdrop.querySelector('.dialog-card').addEventListener('click', (e) => e.stopPropagation());
      backdrop.querySelector('.dialog-cancel').addEventListener('click', () => close(null));
      backdrop.querySelectorAll('.chooser-opt').forEach((b) => b.addEventListener('click', () => close(b.dataset.id)));
      document.addEventListener('keydown', onKey);
    });
  }

  btn.addEventListener('click', () => { if (input) input.click(); });

  if (input) input.addEventListener('change', async () => {
    const files = Array.from(input.files || []).filter((f) => /^(image|video)\//.test(f.type || ''));
    input.value = '';
    if (!files.length) return;

    const collectionId = await pickCollection(files.length);
    if (collectionId === null) return; // cancelled

    const eta = makeUploadEta(files);
    let done = 0;
    let uploaded = 0;
    const label = () => `Uploading ${Math.min(done + 1, files.length)}/${files.length} · ${eta.text()}…`;
    const ticker = setInterval(() => show(label()), 1000);
    try {
      const queue = files.slice();
      const worker = async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          show(label());
          try {
            let res;
            if (wantsDriveDirect(file)) {
              const df = await uploadToDrive(file, (sent) => eta.progress(file, sent));
              res = await fetch('/gallery/register-drive', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ drive_id: df.id, file_name: file.name, mime: file.type, collection_id: collectionId }),
              });
            } else {
              const fd = new FormData();
              fd.append('file', file);
              if (collectionId) fd.append('collection_id', collectionId);
              res = await postFormWithProgress('/gallery', fd, (sent) => eta.progress(file, sent));
            }
            if (res.ok) uploaded += 1;
          } catch (_) { /* skip failed file */ }
          eta.fileDone(file);
          done += 1;
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
    } finally {
      clearInterval(ticker);
    }
    show('');
    // Persist the bell notification before reloading (reload can abort in-flight
    // fetches, so await it rather than fire-and-forget).
    if (uploaded > 1) {
      try {
        await fetch('/gallery/notify-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: uploaded }),
        });
      } catch (_) { /* best-effort */ }
    }
    location.reload(); // show the new photos in the library grid
  });
}

function formatDuration(secs) {
  secs = Math.max(1, Math.round(secs));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return secs % 60 ? `${m}m ${secs % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── Editor media: upload / remove / reorder / bulk select ───────────────────
// One editor page can hold several of these grids — the story's own photos and
// one per alternate ending edited inline below them — so every control is
// looked up inside its own section rather than by a page-wide id.
function initMedia() {
  document.querySelectorAll('[data-media-section]').forEach(initMediaSection);
}

function initMediaSection(section) {
  const grid = section.querySelector('.media-grid');
  if (!grid) return;
  const bookId = grid.dataset.book;
  const input = section.querySelector('[data-media-input]');
  const addBtn = section.querySelector('[data-add-media]');
  const addTile = section.querySelector('[data-add-tile]');
  // Only the story's own grid renames an untitled story after a dropped folder;
  // an ending's grid leaves the story's title alone.
  const isPrimary = section.dataset.primary === '1';

  function trigger() { input.click(); }
  if (addBtn) addBtn.addEventListener('click', trigger);
  if (addTile) addTile.addEventListener('click', trigger);

  const progress = section.querySelector('[data-upload-progress]');
  function showProgress(done, total, eta) {
    if (!progress) return;
    if (total <= 0) { progress.hidden = true; progress.textContent = ''; return; }
    progress.hidden = false;
    progress.textContent = `Uploading ${done}/${total}${eta ? ` · ${eta.text()}` : ''}…`;
  }

  // Upload a list of files, a few at a time. When folderName is set, an
  // untitled story is renamed after it (mirrored on the server via set_title).
  // Placeholder tiles are created in file order as uploads start and replaced
  // in place, so the grid keeps the sorted order even when uploads finish out
  // of order; saveOrder() at the end makes the server match the grid.
  const UPLOAD_CONCURRENCY = 2;
  async function uploadList(files, folderName) {
    if (!files.length) return;
    if (folderName) applyFolderTitle(folderName);
    const total = files.length;
    const eta = makeUploadEta(files);
    let done = 0;
    let failed = 0;
    // Tick every second so the time-left estimate counts down between files.
    const ticker = setInterval(() => showProgress(Math.min(done + 1, total), total, eta), 1000);
    try {
      const queue = files.slice();
      const worker = async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          showProgress(Math.min(done + 1, total), total, eta);
          const good = await uploadFile(file, (folderName && isPrimary) ? { setTitle: folderName } : {}, (sent) => eta.progress(file, sent));
          if (good === false) failed += 1;
          eta.fileDone(file);
          done += 1;
        }
      };
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker));
    } finally {
      clearInterval(ticker);
    }
    showProgress(0, 0);
    refreshOrders();
    if (total > 1) await saveOrder();
    // One bell notification per batch (skip trivial single-photo adds).
    if (total > 1) notifyUploadComplete(`/stories/${bookId}/media/notify-complete`, total - failed);
  }

  // Natural file-name sort: 1,2,…,10 (not 1,10,2); non-numeric names fall to A–Z.
  function sortByName(files) {
    return files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  if (input) {
    input.addEventListener('change', async () => {
      await uploadList(Array.from(input.files || []), '');
      input.value = '';
    });
  }

  // Folder upload via the picker — pulls out images, sorts by name, titles an
  // untitled story after the folder.
  const folderBtn = section.querySelector('[data-add-folder]');
  const folderInput = section.querySelector('[data-folder-input]');
  if (folderBtn && folderInput) folderBtn.addEventListener('click', () => pickFolder());
  if (folderInput) {
    folderInput.addEventListener('change', async () => {
      const all = Array.from(folderInput.files || []);
      const images = sortByName(all.filter((f) => (f.type || '').startsWith('image/')));
      await uploadList(images, folderNameOf(all[0]));
      folderInput.value = '';
    });
  }

  // Where the File System Access API exists (Chrome/Edge over https), use the
  // system directory picker — its lightweight "view files" permission replaces
  // the scary "Upload N files to this site?" dialog that <input webkitdirectory>
  // triggers. Other browsers fall back to that input.
  async function pickFolder() {
    if (!window.showDirectoryPicker) return folderInput.click();
    let dir;
    try {
      dir = await window.showDirectoryPicker();
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user cancelled the picker
      return folderInput.click(); // API blocked (e.g. plain-http) — classic picker
    }
    const files = await collectDirFiles(dir);
    const images = sortByName(files.filter((f) => (f.type || '').startsWith('image/')));
    await uploadList(images, dir.name);
  }

  // Top folder segment of a webkitdirectory file path ("Folder/img.png" → "Folder").
  function folderNameOf(file) {
    const rel = (file && file.webkitRelativePath) || '';
    const seg = rel.split('/').filter(Boolean);
    return seg.length > 1 ? seg[0] : '';
  }

  // Mirror the server: only rename a story that still has its default title.
  function applyFolderTitle(name) {
    if (!name || !isPrimary) return;
    const titleInput = document.getElementById('titleInput');
    if (!titleInput) return;
    const cur = (titleInput.value || '').trim();
    if (cur === '' || /^untitled (story|novel)$/i.test(cur)) {
      titleInput.value = name;
      const coverTitle = document.getElementById('coverTitle');
      if (coverTitle) coverTitle.textContent = name;
    }
  }

  const dropzone = grid.closest('.panel') || grid;
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  dropzone.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    dropzone.classList.add('drop-active');
  });
  dropzone.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  dropzone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('drop-active');
  });
  dropzone.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('drop-active');

    const items = Array.from(e.dataTransfer.items || []);
    const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);

    // A single dropped folder names the story after itself.
    let folderName = '';
    if (entries.length === 1 && entries[0].isDirectory) folderName = entries[0].name;

    let files;
    if (entries.length) {
      const collected = (await Promise.all(entries.map(readEntryFiles))).flat();
      files = sortByName(collected.filter((f) => (f.type || '').startsWith('image/')));
    } else {
      // Browsers without the entries API: fall back to the flat file list.
      files = sortByName(Array.from(e.dataTransfer.files || []).filter((f) => (f.type || '').startsWith('image/')));
    }
    await uploadList(files, folderName);
  });

  async function uploadFile(file, opts = {}, onProgress) {
    const tile = makeUploadingTile(file);
    grid.insertBefore(tile, addTile);
    try {
      let res;
      if (wantsDriveDirect(file)) {
        const df = await uploadToDrive(file, onProgress);
        res = await fetch(`/stories/${bookId}/media/register-drive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            drive_id: df.id,
            file_name: file.name,
            mime: file.type,
            label: file.name.replace(/\.[^.]+$/, ''),
            set_title: opts.setTitle || '',
          }),
        });
      } else {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('label', file.name.replace(/\.[^.]+$/, ''));
        if (opts.setTitle) fd.append('set_title', opts.setTitle);
        res = await postFormWithProgress(`/stories/${bookId}/media`, fd, onProgress);
      }
      if (!res.ok) {
        let msg = 'Upload failed';
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) { /* non-JSON */ }
        throw new Error(msg);
      }
      const data = await res.json();
      const items = data.items || (data.id ? [data] : []);
      if (!items.length) throw new Error('No media returned');
      // One upload can yield several tiles (e.g. a PDF → one image per page).
      const tiles = items.map(makeTile);
      tile.replaceWith(tiles[0]);
      for (let k = 1; k < tiles.length; k++) tiles[k - 1].after(tiles[k]);
      items.forEach((m) => bindTile(grid.querySelector(`[data-media-id="${m.id}"]`)));
      refreshOrders();
      return true;
    } catch (err) {
      tile.classList.remove('uploading');
      tile.classList.add('failed');
      const nameEl = tile.querySelector('.media-name');
      const msg = (err && err.message) ? err.message.replace(/^Upload failed:\s*/, '') : 'Upload failed';
      if (nameEl) { nameEl.textContent = msg; nameEl.title = msg; }
      setTimeout(() => tile.remove(), 4000);
      return false;
    }
  }

  // Placeholder tile shown while a file uploads: instant local preview for
  // images, dimmed under a spinner overlay until the server responds.
  function makeUploadingTile(file) {
    const el = document.createElement('div');
    el.className = 'media-tile uploading';
    const isImg = file.type && file.type.startsWith('image/');
    const previewUrl = isImg ? URL.createObjectURL(file) : '';
    el.innerHTML =
      '<div class="media-thumb">' +
        (previewUrl ? `<img class="upload-preview" src="${previewUrl}" alt="" draggable="false">` : '') +
        '<div class="upload-overlay"><span class="spinner"></span></div>' +
      '</div>' +
      `<div class="media-name">Uploading ${escapeHtml(file.name)}…</div>`;
    if (previewUrl) {
      const img = el.querySelector('.upload-preview');
      img.addEventListener('load', () => URL.revokeObjectURL(previewUrl));
    }
    return el;
  }

  function thumbInner(m) {
    if (m.kind === 'photo') return `<img src="/media/${m.id}?w=640" alt="" draggable="false">`;
    if (m.kind === 'video') return `<video src="/media/${m.id}#t=0.1" muted preload="metadata"></video>`;
    return `<span class="media-kind">${escapeHtml((m.kind || 'file').toUpperCase())}</span>`;
  }

  function makeTile(m) {
    const el = document.createElement('div');
    el.className = 'media-tile';
    el.dataset.mediaId = m.id;
    el.innerHTML = `
      <div class="media-thumb">
        <span class="tile-check" aria-hidden="true">✓</span>
        <select class="media-order" aria-label="Position"></select>
        <button type="button" class="media-remove" data-remove="${m.id}" title="Remove">×</button>
        ${thumbInner(m)}
      </div>
      <div class="media-name">${escapeHtml(m.label || m.file_name || 'Untitled')}</div>`;
    return el;
  }

  // Number-based reorder — each tile carries a position dropdown (1..n). Picking
  // a new number moves that image there and shifts the rest to make room, e.g.
  // changing image 5 to 2 pushes the old 2→3, 3→4, 4→5. Far friendlier on
  // touch than dragging, and works identically on every device.
  function orderableTiles() {
    // Tiles still uploading / failed have no media id and don't take a slot.
    return [...grid.querySelectorAll('.media-tile:not(.uploading):not(.failed)')];
  }

  function bindTile(tile) {
    if (!tile) return;
    const removeBtn = tile.querySelector('[data-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = removeBtn.dataset.remove;
        await fetch(`/stories/${bookId}/media/${id}/delete`, { method: 'POST' });
        flipMove(() => tile.remove());
        refreshOrders();
        saveOrder();
      });
    }
  }

  // Point every tile's dropdown at its current slot, rebuilding the 1..n option
  // list whenever the number of images changes.
  function refreshOrders() {
    const tiles = orderableTiles();
    const n = tiles.length;
    tiles.forEach((tile, i) => {
      const sel = tile.querySelector('.media-order');
      if (!sel) return;
      if (sel.options.length !== n) {
        const frag = document.createDocumentFragment();
        for (let k = 1; k <= n; k++) {
          const o = document.createElement('option');
          o.value = String(k);
          o.textContent = String(k);
          frag.appendChild(o);
        }
        sel.replaceChildren(frag);
      }
      sel.value = String(i + 1);
    });
  }

  // Move a tile to a new 0-based slot, shifting the others, then persist.
  function moveTile(tile, toIndex) {
    const tiles = orderableTiles();
    const from = tiles.indexOf(tile);
    if (from < 0) return;
    toIndex = Math.max(0, Math.min(toIndex, tiles.length - 1));
    if (from === toIndex) return;
    tiles.splice(from, 1);
    tiles.splice(toIndex, 0, tile);
    flipMove(() => tiles.forEach((t) => grid.insertBefore(t, addTile)));
    refreshOrders();
    saveOrder();
  }

  grid.addEventListener('change', (e) => {
    const sel = e.target.closest('.media-order');
    if (!sel) return;
    const tile = sel.closest('.media-tile');
    if (tile) moveTile(tile, parseInt(sel.value, 10) - 1);
  });

  // FLIP: smoothly slide the tiles to their new spots when the order changes.
  function flipMove(mutate) {
    const tiles = [...grid.querySelectorAll('.media-tile')];
    const first = new Map();
    tiles.forEach((t) => first.set(t, t.getBoundingClientRect()));
    mutate();
    [...grid.querySelectorAll('.media-tile')].forEach((t) => {
      const f = first.get(t);
      if (!f) return;
      const l = t.getBoundingClientRect();
      const dx = f.left - l.left;
      const dy = f.top - l.top;
      if (!dx && !dy) return;
      t.style.transition = 'none';
      t.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        t.style.transition = 'transform .18s ease';
        t.style.transform = '';
      });
    });
  }

  async function saveOrder() {
    const ids = orderableTiles().map((t) => t.dataset.mediaId).filter(Boolean);
    await fetch(`/stories/${bookId}/media/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids }),
    });
  }

  // ── Select mode: tick several tiles and clear them out in one go ──────────
  // Removing a bad batch one ✕ at a time is nobody's idea of an afternoon.
  const selectBtn = section.querySelector('[data-select-media]');
  const selectBar = section.querySelector('[data-select-bar]');
  if (selectBtn && selectBar) {
    const countEl = selectBar.querySelector('[data-select-count]');
    const deleteBtn = selectBar.querySelector('[data-select-delete]');
    const allBtn = selectBar.querySelector('[data-select-all]');
    const selected = () => [...grid.querySelectorAll('.media-tile.selected')];

    function update() {
      const n = selected().length;
      if (countEl) countEl.textContent = `${n} ${n === 1 ? 'item' : 'items'} selected`;
      if (deleteBtn) deleteBtn.disabled = !n;
      if (allBtn) allBtn.textContent = n && n === orderableTiles().length ? 'Select none' : 'Select all';
    }
    function exitSelect() {
      grid.classList.remove('select-mode');
      selected().forEach((t) => t.classList.remove('selected'));
      selectBar.hidden = true;
      selectBtn.classList.remove('on');
    }

    selectBtn.addEventListener('click', () => {
      if (grid.classList.contains('select-mode')) return exitSelect();
      grid.classList.add('select-mode');
      selectBar.hidden = false;
      selectBtn.classList.add('on');
      update();
    });
    selectBar.querySelector('[data-select-cancel]').addEventListener('click', exitSelect);
    if (allBtn) allBtn.addEventListener('click', () => {
      const tiles = orderableTiles();
      const all = selected().length === tiles.length;
      tiles.forEach((t) => t.classList.toggle('selected', !all));
      update();
    });

    // Capture phase: in select mode a click ticks the tile instead of reaching
    // the order dropdown or the per-tile ✕ underneath it.
    grid.addEventListener('click', (e) => {
      if (!grid.classList.contains('select-mode')) return;
      const tile = e.target.closest('.media-tile');
      if (!tile || tile.classList.contains('uploading') || tile.classList.contains('failed')) return;
      e.preventDefault();
      e.stopPropagation();
      tile.classList.toggle('selected');
      update();
    }, true);

    if (deleteBtn) deleteBtn.addEventListener('click', () => {
      const tiles = selected();
      if (!tiles.length) return;
      const n = tiles.length;
      openDialog({
        title: 'Remove media?',
        body: `Remove ${n} ${n === 1 ? 'item' : 'items'} from this story? This can’t be undone.`,
        confirmLabel: 'Remove',
        danger: true,
        onConfirm: async () => {
          deleteBtn.disabled = true;
          const ids = tiles.map((t) => t.dataset.mediaId).filter(Boolean);
          try {
            const res = await fetch(`/stories/${bookId}/media/bulk-delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids }),
            });
            if (!res.ok) throw new Error('failed');
            flipMove(() => tiles.forEach((t) => t.remove()));
            refreshOrders();
            await saveOrder();
            exitSelect();
            showToast(`${n} ${n === 1 ? 'item' : 'items'} removed ✓`);
          } catch (_) {
            showToast('Could not remove those — please try again', 'error');
          } finally {
            deleteBtn.disabled = false;
          }
        },
      });
    });
  }

  orderableTiles().forEach(bindTile);
  refreshOrders();
}

// ── Editor: alternate endings edited in place ───────────────────────────────
// Each ending is a fold-out card holding its name and its own photo grid. They
// start shut so a story with a dozen endings doesn't fetch every thumbnail at
// once; the name typed inside keeps the card's header honest.
function initEndingCards() {
  document.querySelectorAll('[data-ending-card]').forEach((card) => {
    const head = card.querySelector('[data-ending-toggle]');
    const body = card.querySelector('.ending-card-body');
    const label = card.querySelector('[data-ending-label]');
    const title = card.querySelector('[data-ending-title]');
    if (!head || !body) return;

    const open = (want) => {
      body.hidden = !want;
      card.classList.toggle('open', want);
      head.setAttribute('aria-expanded', want ? 'true' : 'false');
    };
    head.addEventListener('click', () => open(body.hidden));

    if (label && title) {
      const fallback = title.textContent;
      label.addEventListener('input', () => { title.textContent = label.value.trim() || fallback; });
    }

    // "Edit this ending" in the reader links straight to this card.
    if (card.id && window.location.hash === '#' + card.id) {
      open(true);
      requestAnimationFrame(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
  });
}

// ── Folder view: sort a folder's stories, remembered per folder ─────────────
// The choice is stored under folderSort:<id>, so each folder keeps its own
// sort and it survives refresh/return.
function initFolderSort() {
  const grid = document.getElementById('folderStories');
  const select = document.getElementById('folderSortSelect');
  if (!grid || !select) return;
  const KEY = 'folderSort:' + grid.dataset.folder;

  function apply(mode) {
    const cards = Array.from(grid.querySelectorAll('.cover-card'));
    const dateDesc = (a, b) => (b.dataset.date || '').localeCompare(a.dataset.date || ''); // newest first
    const name = (a, b) => (a.dataset.title || '').localeCompare(b.dataset.title || '', undefined, { numeric: true, sensitivity: 'base' });
    let cmp;
    if (mode === 'oldest') cmp = (a, b) => dateDesc(b, a);
    else if (mode === 'az') cmp = name;
    else if (mode === 'za') cmp = (a, b) => name(b, a);
    else if (mode === 'fav') cmp = (a, b) => (Number(b.dataset.fav) - Number(a.dataset.fav)) || dateDesc(a, b);
    else cmp = dateDesc; // 'latest'
    cards.sort(cmp).forEach((c) => grid.appendChild(c)); // re-append in new order
  }

  let saved = 'latest';
  try { saved = localStorage.getItem(KEY) || 'latest'; } catch (_) { /* private mode */ }
  select.value = saved;
  apply(saved);

  select.addEventListener('change', () => {
    apply(select.value);
    try { localStorage.setItem(KEY, select.value); } catch (_) { /* ignore */ }
  });
}

// ── Reader: grid/list toggle for a photo story's images ─────────────────────
// The choice is remembered in localStorage, so it survives refresh/return.
function initReaderFigs() {
  // A story with alternate endings renders two galleries — its own and the open
  // ending's. One toggle drives both.
  const galleries = Array.from(document.querySelectorAll('.reader-figs'));
  const toggle = document.getElementById('figsView');
  if (!galleries.length || !toggle) return;
  const KEY = 'readerFigsView';
  const buttons = toggle.querySelectorAll('button[data-view]');

  function apply(view) {
    galleries.forEach((figs) => {
      figs.classList.toggle('grid', view === 'grid');
      figs.dispatchEvent(new CustomEvent('reader:viewchange')); // reload loaded imgs at the new size
    });
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    try { localStorage.setItem(KEY, view); } catch (_) { /* private mode */ }
  }

  let saved = 'list';
  try { if (localStorage.getItem(KEY) === 'grid') saved = 'grid'; } catch (_) { /* ignore */ }
  apply(saved);

  // Bind each button directly (reliable taps on mobile).
  buttons.forEach((b) => b.addEventListener('click', () => apply(b.dataset.view)));
}

// ── Reader: fold a story's sections away ────────────────────────────────────
// A story can run to hundreds of photos, and its endings to hundreds more —
// folding a section shut is the only way to reach what's under it. Sections
// start open (the story is what you came for) and the choice is remembered per
// story, so a story you always read collapsed stays that way.
function initReaderSections() {
  document.querySelectorAll('.reader-section').forEach((section) => {
    const toggle = section.querySelector('[data-section-toggle]');
    const body = section.querySelector('.section-body');
    if (!toggle || !body) return;
    const KEY = `readerSection:${section.dataset.book}:${section.dataset.section}`;

    function apply(open, save) {
      section.classList.toggle('collapsed', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (save) { try { localStorage.setItem(KEY, open ? 'open' : 'shut'); } catch (_) { /* private mode */ } }
    }

    let open = true;
    try { open = localStorage.getItem(KEY) !== 'shut'; } catch (_) { /* ignore */ }
    apply(open, false);

    toggle.addEventListener('click', () => apply(section.classList.contains('collapsed'), true));
  });
}

// ── Reader: switch between a story's alternate endings ──────────────────────
// Every ending's gallery is already on the page, so a tab swaps which panel is
// visible — no page load, and the reader keeps its place instead of being
// thrown back to the top of the story. The URL follows along so a reload, a
// share or the back button all land on the ending you were reading.
function initEndingTabs() {
  const strip = document.getElementById('endingTabs');
  if (!strip) return;
  const tabs = [...strip.querySelectorAll('.ending-tab')];
  const panels = [...document.querySelectorAll('.ending-panel')];
  if (!tabs.length) return;

  function show(id, push) {
    let matched = false;
    panels.forEach((p) => {
      const on = p.dataset.ending === id;
      p.hidden = !on;
      matched = matched || on;
    });
    if (!matched) return;
    tabs.forEach((t) => {
      const on = t.dataset.ending === id;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // The photos in the panel just shown were never loaded (see windowImages);
    // unhiding them is a visibility change, which the observer picks up itself.
    if (push) {
      const url = new URL(window.location.href);
      url.searchParams.set('ending', id);
      window.history.pushState({ ending: id }, '', url.toString());
    }
  }

  strip.addEventListener('click', (e) => {
    const tab = e.target.closest('.ending-tab');
    if (!tab) return;
    e.preventDefault();
    show(tab.dataset.ending, true);
  });

  window.addEventListener('popstate', () => {
    const id = new URL(window.location.href).searchParams.get('ending');
    show(id || (tabs[0] && tabs[0].dataset.ending), false);
  });
}

// ── Reader: window the photo grid ───────────────────────────────────────────
// A story can hold hundreds of photos. loading="lazy" only defers the initial
// load — once you scroll past an image Safari keeps its decoded bitmap, so
// memory climbs until the phone's per-tab budget is hit and the tab crashes
// ("A problem repeatedly occurred"). Each .photo-frame reserves its space with
// a fixed CSS aspect-ratio, so we can drop an off-screen image's src to free
// its memory with no layout shift, and reload it when it scrolls back — keeping
// the number of decoded images (and thus memory) bounded to the visible window.
// Keep only images near the viewport loaded. `widthFor()` returns the ?w= width
// to request (tiny grid tiles need far less than full-width list images). The
// window is small on purpose: a story can hold 500+ photos, and every decoded
// image counts against the phone's per-tab budget. `refresh` (optional) is an
// element that fires 'reader:viewchange' when layout changes so loaded images
// re-request at the new size.
function windowImages(imgs, widthFor, refresh) {
  if (!imgs.length) return;
  const srcFor = (img) => `${img.dataset.full}?w=${widthFor()}`;
  const mount = (img) => { const s = srcFor(img); if (img.getAttribute('src') !== s) img.src = s; };
  const unmount = (img) => { if (img.getAttribute('src')) img.removeAttribute('src'); };

  // Old browser, or fast preview on a set small enough to hold entirely: load
  // every image up front and never unmount, so nothing ever waits on a scroll.
  const mountAll = !('IntersectionObserver' in window) || (FAST_PREVIEW && imgs.length <= FAST_MOUNT_ALL_MAX);
  if (mountAll) {
    imgs.forEach(mount);
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) mount(e.target); else unmount(e.target); }
    }, { rootMargin: FAST_PREVIEW ? '2000px 0px' : '400px 0px', threshold: 0 });
    imgs.forEach((img) => io.observe(img));
  }

  if (refresh) refresh.addEventListener('reader:viewchange', () => {
    imgs.forEach((img) => { if (img.getAttribute('src')) mount(img); }); // reload visible at new size
  });
}

function initReaderFigWindow() {
  // Both the story's gallery and its open ending's are windowed independently.
  document.querySelectorAll('.reader-figs').forEach((figs) => {
    // Grid tiles are small (~2-4 per row); list images span the column.
    windowImages(Array.from(figs.querySelectorAll('img[data-full]')),
      () => (figs.classList.contains('grid') ? 640 : 1080), figs);
  });
  const body = document.querySelector('.story-body');
  if (body) windowImages(Array.from(body.querySelectorAll('img[data-full]')), () => 1080, null);
}

// ── Memory-bounded windowing for a MIX of <img> and <video> tiles ───────────
// Like windowImages, but also handles <video data-full> tiles: a live <video>
// element holds a decoded frame and iOS caps how many can exist at once, so a
// grid of many videos crashes the tab ("A problem repeatedly occurred"). We keep
// only tiles near the viewport loaded — mounting sets the src (video previews at
// #t=0.1), and off-screen tiles have their src removed (video.load() releases the
// decoded frame). Elements must start with NO src, just data-full. Returns the
// IntersectionObserver so callers can observe tiles added later (e.g. uploads).
function windowMedia(els, widthFor) {
  const mount = (el) => {
    if (el.tagName === 'VIDEO') {
      const want = el.dataset.full + '#t=0.1';
      if (el.getAttribute('src') !== want) { el.src = want; el.load(); }
    } else {
      const want = `${el.dataset.full}?w=${widthFor()}`;
      if (el.getAttribute('src') !== want) el.src = want;
    }
  };
  const unmount = (el) => {
    if (!el.getAttribute('src')) return;
    el.removeAttribute('src');
    if (el.tagName === 'VIDEO') el.load(); // free the decoded frame / media resource
  };
  if (!('IntersectionObserver' in window)) { els.forEach(mount); return null; }

  // Fast preview on a small enough grid: mount every image up front and never
  // unmount it, so scrolling back never re-fetches. Videos stay windowed either
  // way — iOS caps how many <video> elements can hold a decoded frame at once,
  // and that cap is what the tab crash comes from.
  const pinImages = FAST_PREVIEW && els.length <= FAST_MOUNT_ALL_MAX;
  const isPinned = (el) => pinImages && el.tagName !== 'VIDEO';
  if (pinImages) els.forEach((el) => { if (isPinned(el)) mount(el); });

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) mount(e.target);
      else if (!isPinned(e.target)) unmount(e.target);
    }
  }, { rootMargin: FAST_PREVIEW ? '2000px 0px' : '600px 0px', threshold: 0 });
  els.forEach((el) => io.observe(el));
  return io;
}

// ── Library: view-only gallery photos shown under the folder tabs ───────────
// The photos live on the dedicated /gallery page for upload/management; here we
// just render memory-bounded thumbnails/videos and open a lightbox on click.
// ── Folder / collection tab strips ──────────────────────────────────────────
// The strip is one scrolling line at every width. Show the "more →" edge fade
// only when it actually overflows (so a few tabs stay snug, not stretched), and
// bring the active tab into view when it starts off-screen. Runs on every page
// that has a strip — library, gallery, favourites.
function initTabStrips() {
  // The reader's endings strip behaves the same way; its active tab is .on.
  document.querySelectorAll('.gallery-tabs .sort-toggle, .ending-tabs').forEach((strip) => {
    const sync = () => strip.classList.toggle('scrollable', strip.scrollWidth > strip.clientWidth + 4);
    sync();
    window.addEventListener('resize', sync);
    const active = strip.querySelector('.active, .on');
    if (active && strip.scrollWidth > strip.clientWidth + 4) {
      // Centre it without scrolling the page itself (scrollIntoView would).
      strip.scrollLeft = Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
    }
  });
}

// Library select mode: tick several story covers, then fold them into one story
// as its alternate endings. Photos in the mixed grid stay untouchable — only
// cover cards take a tick.
function initLibraryEndings() {
  const grid = document.getElementById('libraryCombined');
  const selectBtn = document.getElementById('librarySelectBtn');
  if (!grid || !selectBtn) return;
  const bar = document.getElementById('librarySelectBar');
  const countEl = document.getElementById('librarySelectCount');

  const selectedCards = () => grid.querySelectorAll('.cover-card.selected');
  const selectedIds = () => [...selectedCards()].map((c) => c.dataset.bookId);
  const update = () => {
    const n = selectedCards().length;
    if (countEl) countEl.textContent = `${n} ${n === 1 ? 'story' : 'stories'} selected`;
  };
  const exit = () => {
    grid.classList.remove('select-mode');
    selectedCards().forEach((c) => c.classList.remove('selected'));
    if (bar) bar.hidden = true;
  };

  selectBtn.addEventListener('click', () => {
    grid.classList.add('select-mode');
    if (bar) bar.hidden = false;
    update();
  });
  document.getElementById('librarySelectCancel').addEventListener('click', exit);

  // Capture phase: in select mode a click ticks the card instead of reaching the
  // card's own data-href navigation handler (bound in the bubble phase).
  grid.addEventListener('click', (e) => {
    if (!grid.classList.contains('select-mode')) return;
    const card = e.target.closest('.cover-card');
    e.preventDefault();
    e.stopPropagation();
    if (!card) return;
    card.classList.toggle('selected');
    update();
  }, true);

  function stories() {
    const el = document.getElementById('libraryStoriesData');
    try { return el ? JSON.parse(el.textContent) : []; } catch (_) { return []; }
  }

  document.getElementById('librarySelectEndings').addEventListener('click', () => {
    const ids = selectedIds();
    if (!ids.length) return;
    // The story that keeps its place in the library — the selected ones become
    // its endings, so it can't be one of them.
    const opts = stories().filter((s) => !ids.includes(String(s.id)));
    if (!opts.length) {
      showToast('Leave at least one story unselected to hold the endings', 'error');
      return;
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.innerHTML =
      '<div class="dialog-card" role="dialog" aria-modal="true">' +
      `<h3>Make ${ids.length} ${ids.length === 1 ? 'story an ending' : 'stories endings'} of…</h3>` +
      '<p>They keep their own photos and leave your library — readers switch between them as tabs on the story you pick.</p>' +
      '<div class="chooser">' +
      opts.map((s) => `<button type="button" class="chooser-opt" data-id="${s.id}">${escapeHtml(s.title)}</button>`).join('') +
      '</div><div class="dialog-actions"><button type="button" class="dialog-cancel">Cancel</button></div></div>';
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', close);
    backdrop.querySelector('.dialog-card').addEventListener('click', (e) => e.stopPropagation());
    backdrop.querySelector('.dialog-cancel').addEventListener('click', close);
    backdrop.querySelectorAll('.chooser-opt').forEach((b) => b.addEventListener('click', async () => {
      close();
      const toast = showToast('Grouping endings…', 'info', 0);
      try {
        const res = await fetch('/stories/bulk-endings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, parent_id: b.dataset.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'failed');
        const n = data.moved;
        toast.done(`${n} ${n === 1 ? 'ending' : 'endings'} added to “${data.parent.title}”${data.skipped ? ` · ${data.skipped} skipped` : ''} ✓`, 'info');
        window.location.href = '/reader/' + data.parent.id;
      } catch (err) {
        toast.done('Could not group those stories — please try again', 'error', 3600);
      }
    }));
  });
}

function initLibraryGallery() {
  // The Library and the Dashboard's "Your library" strip both mix story covers
  // with gallery photos in one grid — bind the same behaviour to whichever exists.
  ['libraryCombined', 'dashLibrary'].forEach((id) => bindPhotoGrid(document.getElementById(id)));
}
function bindPhotoGrid(grid) {
  if (!grid) return;
  windowMedia(Array.from(grid.querySelectorAll('img[data-full], video[data-full]')), () => 640);
  grid.addEventListener('click', async (e) => {
    // The heart toggles a photo's favourite flag (no reload).
    const fav = e.target.closest('.gallery-fav');
    if (fav) {
      e.preventDefault(); e.stopPropagation();
      const tile = fav.closest('.gallery-tile');
      fav.disabled = true;
      try {
        const res = await fetch('/gallery/' + tile.dataset.id + '/favourite', { method: 'POST', headers: { 'X-Requested-With': 'fetch' } });
        const data = await res.json();
        fav.classList.toggle('faved', data.favourite);
        fav.textContent = data.favourite ? '♥' : '♡';
      } catch (_) { /* ignore */ } finally { fav.disabled = false; }
      return;
    }
    const clicked = e.target.closest('.gallery-tile img, .gallery-tile video');
    if (!clicked) return;
    const items = [...grid.querySelectorAll('.gallery-tile img, .gallery-tile video')];
    openLightbox(
      items.map((x) => ({ src: x.dataset.full || x.currentSrc || x.src, thumb: x.currentSrc || x.getAttribute('src') || '', caption: '', kind: x.tagName === 'VIDEO' ? 'video' : 'photo' })),
      items.indexOf(clicked),
      (end) => { if (items[end]) items[end].scrollIntoView({ block: 'center' }); }
    );
  });
}

// ── Favourites page: one combined grid of favourited stories + gallery media ──
// (heart to un-favourite, click a photo to zoom; stories navigate via data-href
// and their hearts use the global .heart-btn handler).
function initFavouritesGallery() {
  const grid = document.getElementById('favouritesCombined');
  if (!grid) return;
  const emptyEl = document.getElementById('favEmpty');
  const showEmptyIfBare = () => {
    if (grid.querySelector('.gallery-tile, .cover-card')) return;
    // Emptying a page isn't emptying the list when more pages follow — reload
    // so the next page's favourites move up rather than claiming there are none.
    if (document.querySelector('.pager')) { window.location.reload(); return; }
    if (emptyEl) emptyEl.hidden = false;
  };
  windowMedia(Array.from(grid.querySelectorAll('img[data-full], video[data-full]')), () => 640);
  grid.addEventListener('click', async (e) => {
    // A photo's heart un-favourites and drops its tile from the page.
    const fav = e.target.closest('.gallery-fav');
    if (fav) {
      e.preventDefault(); e.stopPropagation();
      const tile = fav.closest('.gallery-tile');
      fav.disabled = true;
      try {
        const res = await fetch('/gallery/' + tile.dataset.id + '/favourite', { method: 'POST', headers: { 'X-Requested-With': 'fetch' } });
        const data = await res.json();
        if (!data.favourite) { tile.remove(); showEmptyIfBare(); }
      } catch (_) { /* ignore */ } finally { fav.disabled = false; }
      return;
    }
    const clicked = e.target.closest('.gallery-tile img, .gallery-tile video');
    if (clicked) {
      const items = [...grid.querySelectorAll('.gallery-tile img, .gallery-tile video')];
      openLightbox(
        items.map((x) => ({ src: x.dataset.full || x.currentSrc || x.src, thumb: x.currentSrc || x.getAttribute('src') || '', caption: '', kind: x.tagName === 'VIDEO' ? 'video' : 'photo' })),
        items.indexOf(clicked),
        (end) => { if (items[end]) items[end].scrollIntoView({ block: 'center' }); }
      );
    }
  });
}

// ── Standalone image gallery (upload, delete, lightbox) ─────────────────────
function initGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  if (grid.dataset.assign) return initGalleryAssign(grid); // bulk-assign mode
  const input = document.getElementById('galleryInput');
  const btn = document.getElementById('galleryUploadBtn');
  const empty = document.getElementById('galleryEmpty');
  const progress = document.getElementById('galleryProgress');
  const newestFirst = grid.dataset.order !== 'oldest';
  const activeCollection = grid.dataset.collection || '';
  let collections = [];
  try { collections = JSON.parse(grid.dataset.collections || '[]'); } catch (_) { /* none */ }

  if (btn && input) btn.addEventListener('click', () => input.click());

  // Window the video tiles so only those near the viewport hold a live <video>
  // (many at once crash iOS). Images already load lazy 640px thumbnails, so they
  // stay light on their own. Newly-uploaded video tiles are observed in addTile.
  const videoWindow = windowMedia(Array.from(grid.querySelectorAll('video[data-full]')), () => 640);

  function showProgress(done, total, eta) {
    if (!progress) return;
    if (total <= 0) { progress.hidden = true; progress.textContent = ''; return; }
    progress.hidden = false;
    progress.textContent = `Uploading ${done}/${total}${eta ? ` · ${eta.text()}` : ''}…`;
  }

  function addTile(img) {
    const el = document.createElement('div');
    el.className = 'gallery-tile';
    el.dataset.id = img.id;
    const isVideo = (img.mime || '').startsWith('video/');
    el.innerHTML =
      '<span class="tile-check" aria-hidden="true">✓</span>' +
      '<button type="button" class="gallery-fav" aria-label="Favourite">♡</button>' +
      (isVideo
        ? `<video muted preload="metadata" data-full="${img.url}"></video><div class="media-play">▶</div>`
        : `<img src="${img.url}?w=640" data-full="${img.url}" alt="" loading="lazy">`) +
      (img.file_name ? `<div class="tile-name" title="${escapeHtml(img.file_name)}">${escapeHtml(img.file_name)}</div>` : '');
    // Newest-first view shows fresh uploads at the top; oldest-first at the bottom.
    grid.insertAdjacentElement(newestFirst ? 'afterbegin' : 'beforeend', el);
    // Keep new video tiles memory-bounded like the initial ones.
    if (isVideo && videoWindow) videoWindow.observe(el.querySelector('video[data-full]'));
    if (empty) empty.hidden = true;
  }

  if (input) {
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []).filter((f) => /^(image|video)\//.test(f.type || ''));
      if (!files.length) { input.value = ''; return; }
      const eta = makeUploadEta(files);
      let done = 0;
      let uploaded = 0;
      const ticker = setInterval(() => showProgress(Math.min(done + 1, files.length), files.length, eta), 1000);
      try {
        // A few files travel at once — much faster for big batches.
        const queue = files.slice();
        const worker = async () => {
          for (let file = queue.shift(); file; file = queue.shift()) {
            showProgress(Math.min(done + 1, files.length), files.length, eta);
            try {
              let res;
              if (wantsDriveDirect(file)) {
                const df = await uploadToDrive(file, (sent) => eta.progress(file, sent));
                res = await fetch('/gallery/register-drive', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ drive_id: df.id, file_name: file.name, mime: file.type, collection_id: activeCollection }),
                });
              } else {
                const fd = new FormData();
                fd.append('file', file);
                if (activeCollection) fd.append('collection_id', activeCollection);
                res = await postFormWithProgress('/gallery', fd, (sent) => eta.progress(file, sent));
              }
              if (res.ok) { addTile(await res.json()); uploaded += 1; }
            } catch (_) { /* skip failed file */ }
            eta.fileDone(file);
            done += 1;
          }
        };
        await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
      } finally {
        clearInterval(ticker);
      }
      showProgress(0, 0);
      input.value = '';
      if (files.length > 1) notifyUploadComplete('/gallery/notify-complete', uploaded);
    });
  }

  // ── Bulk select: download / delete several images at once ──────────────────
  const selectBtn = document.getElementById('gallerySelectBtn');
  const selectBar = document.getElementById('gallerySelectBar');
  const selectCount = document.getElementById('gallerySelectCount');
  const selectedTiles = () => grid.querySelectorAll('.gallery-tile.selected');
  const selectedIds = () => [...selectedTiles()].map((t) => t.dataset.id);

  function updateSelect() {
    const n = selectedTiles().length;
    if (selectCount) selectCount.textContent = `${n} ${n === 1 ? 'image' : 'images'} selected`;
  }
  function exitSelect() {
    grid.classList.remove('select-mode');
    selectedTiles().forEach((t) => t.classList.remove('selected'));
    if (selectBar) selectBar.hidden = true;
  }
  if (selectBtn) selectBtn.addEventListener('click', () => {
    grid.classList.add('select-mode');
    if (selectBar) selectBar.hidden = false;
    updateSelect();
  });
  const selCancel = document.getElementById('gallerySelectCancel');
  if (selCancel) selCancel.addEventListener('click', exitSelect);

  // Chooser dialog for adding the selected images to a collection (or removing
  // them from one via "No collection").
  function openBulkCollectionChooser(ids) {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const opts = collections.concat([{ id: '', name: 'No collection (remove)' }]);
    backdrop.innerHTML =
      '<div class="dialog-card" role="dialog" aria-modal="true">' +
      `<h3>Add ${ids.length} ${ids.length === 1 ? 'image' : 'images'} to…</h3>` +
      '<div class="chooser">' +
      opts.map((c) => `<button type="button" class="chooser-opt" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join('') +
      '</div><div class="dialog-actions"><button type="button" class="dialog-cancel">Cancel</button></div></div>';
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', close);
    backdrop.querySelector('.dialog-card').addEventListener('click', (e) => e.stopPropagation());
    backdrop.querySelector('.dialog-cancel').addEventListener('click', close);
    backdrop.querySelectorAll('.chooser-opt').forEach((b) => b.addEventListener('click', async () => {
      await fetch('/gallery/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, collection_id: b.dataset.id }),
      });
      close();
      // If viewing a specific collection and the images moved elsewhere, drop them.
      if (activeCollection && b.dataset.id !== activeCollection) {
        selectedTiles().forEach((t) => t.remove());
        if (empty && !grid.querySelector('.gallery-tile')) empty.hidden = false;
      }
      exitSelect();
    }));
  }
  const selAssign = document.getElementById('gallerySelectAssign');
  if (selAssign) selAssign.addEventListener('click', () => {
    const ids = selectedIds();
    if (ids.length) openBulkCollectionChooser(ids);
  });

  const selDownload = document.getElementById('gallerySelectDownload');
  if (selDownload) selDownload.addEventListener('click', async () => {
    const ids = selectedIds();
    if (!ids.length) return;
    const n = ids.length;
    const label = `${n} ${n === 1 ? 'item' : 'items'}`;
    const toast = showToast(`Downloading ${label}…`, 'info', 0);
    selDownload.disabled = true;
    const onProgress = (frac) => toast.update(`Downloading ${label}… ${Math.round(frac * 100)}%`);
    try {
      // A single item downloads straight from its media URL — streamed with its
      // real filename/extension (so a video comes down as a playable .mp4).
      // Multiple items are zipped server-side. Either way we resolve when the
      // whole file has arrived, then confirm with a completion toast.
      if (n === 1) {
        await saveDownload('/gallery/' + ids[0] + '/raw?download=1', undefined, onProgress);
      } else {
        await saveDownload('/gallery/bulk-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        }, onProgress);
      }
      toast.done(`Downloaded ${label} ✓`, 'info');
    } catch (err) {
      toast.done('Download failed — please try again', 'error', 3600);
    } finally {
      selDownload.disabled = false;
    }
  });

  const selDelete = document.getElementById('gallerySelectDelete');
  if (selDelete) selDelete.addEventListener('click', () => {
    const ids = selectedIds();
    if (!ids.length) return;
    const n = ids.length;
    openDialog({
      title: 'Delete media?',
      body: `Delete ${n} ${n === 1 ? 'item' : 'items'}? This can’t be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        selDelete.disabled = true;
        try {
          await fetch('/gallery/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          });
          selectedTiles().forEach((t) => t.remove());
          // With more pages behind this one, emptying the page doesn't mean the
          // gallery is empty — reload so the following page's media move up.
          if (!grid.querySelector('.gallery-tile') && document.querySelector('.pager')) {
            window.location.reload();
            return;
          }
          if (empty && !grid.querySelector('.gallery-tile')) empty.hidden = false;
          exitSelect();
        } finally {
          selDelete.disabled = false;
        }
      },
    });
  });

  // Toggle an image's favourite flag when its heart is tapped (owner only).
  async function toggleFav(fav) {
    const tile = fav.closest('.gallery-tile');
    if (!tile) return;
    fav.disabled = true;
    try {
      const res = await fetch('/gallery/' + tile.dataset.id + '/favourite', { method: 'POST', headers: { 'X-Requested-With': 'fetch' } });
      const data = await res.json();
      fav.classList.toggle('faved', data.favourite);
      fav.textContent = data.favourite ? '♥' : '♡';
      // In the Favourites tab, un-favouriting drops the tile from view.
      if (grid.dataset.fav && !data.favourite) {
        tile.remove();
        if (empty && !grid.querySelector('.gallery-tile')) empty.hidden = false;
      }
    } catch (_) { /* ignore */ } finally {
      fav.disabled = false;
    }
  }

  grid.addEventListener('click', (e) => {
    // The heart toggles favourite (in any mode) — handle it before selection/zoom.
    const fav = e.target.closest('.gallery-fav');
    if (fav) { e.preventDefault(); e.stopPropagation(); toggleFav(fav); return; }
    // In select mode, tapping a tile toggles its selection instead of zooming.
    if (grid.classList.contains('select-mode')) {
      const tile = e.target.closest('.gallery-tile');
      if (tile) { e.preventDefault(); tile.classList.toggle('selected'); updateSelect(); }
      return;
    }
    const clicked = e.target.closest('.gallery-tile img, .gallery-tile video');
    if (clicked) {
      const items = [...grid.querySelectorAll('.gallery-tile img, .gallery-tile video')];
      openLightbox(
        items.map((x) => ({ src: x.dataset.full || x.currentSrc || x.src, thumb: x.currentSrc || x.getAttribute('src') || '', caption: '', kind: x.tagName === 'VIDEO' ? 'video' : 'photo' })),
        items.indexOf(clicked),
        (end) => { if (items[end]) items[end].scrollIntoView({ block: 'center' }); }
      );
    }
  });
}

// Gallery bulk-assign mode: tap tiles to toggle selection (no lightbox), then
// Save posts the full selected set as the collection's membership.
function initGalleryAssign(grid) {
  const collId = grid.dataset.collection;
  const countEl = document.getElementById('assignCount');
  const saveBtn = document.getElementById('assignSave');

  const update = () => {
    const n = grid.querySelectorAll('.gallery-tile.selected').length;
    if (countEl) countEl.textContent = `${n} ${n === 1 ? 'image' : 'images'} selected`;
  };

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.gallery-tile');
    if (!tile) return;
    e.preventDefault();
    tile.classList.toggle('selected');
    update();
  });
  update();

  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const ids = [...grid.querySelectorAll('.gallery-tile.selected')].map((t) => t.dataset.id);
    saveBtn.disabled = true;
    try {
      await fetch('/gallery/collections/' + collId + '/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      window.location.href = '/gallery?collection=' + collId; // back to the collection
    } catch (_) {
      saveBtn.disabled = false;
    }
  });
}
