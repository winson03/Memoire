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

// ── Lightbox (full-size image viewer) ────────────────────────────────────────
// Full-screen image viewer. `items` is an array of { src, caption }; the
// viewer opens at `index` and can slide between images (buttons, arrow keys,
// swipe).
function openLightbox(items, index) {
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

  function render() {
    const it = items[i];
    mediaEl.innerHTML = it.kind === 'video'
      ? `<video src="${it.src}" controls autoplay></video>`
      : `<img src="${it.src}" alt="">`;
    capEl.textContent = it.caption || '';
    capEl.style.display = it.caption ? '' : 'none';
    if (multi) countEl.textContent = `${i + 1} / ${items.length}`;
  }
  function go(d) { i = (i + d + items.length) % items.length; render(); }
  function close() {
    bd.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
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
        const fd = new FormData();
        fd.append('file', files[i]);
        try {
          const res = await fetch(`/stories/${bookId}/media`, { method: 'POST', body: fd });
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
  const SAVE_LABELS = { published: 'Publish story', private: 'Save privately', draft: 'Save as draft' };
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

  // Media management (editor).
  initMedia();

  // Standalone image gallery.
  initGallery();

  // Library: bulk folder import (1 folder = 1 private story).
  initFolderImport();

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
    const gallery = figImgs.map((img) => {
      const fig = img.closest('figure');
      const fc = fig && fig.querySelector('figcaption');
      return { src: img.getAttribute('src'), caption: ((fc && fc.textContent) || '').trim() };
    });
    figImgs.forEach((img, idx) => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => openLightbox(gallery, idx));
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
      const fd = new FormData();
      fd.append('cover', file);
      try {
        const res = await fetch(`/stories/${coverUploadBtn.dataset.book}/cover`, { method: 'POST', body: fd });
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

// Pop a transient toast (reuses the server flash styling). Auto-dismisses.
// If the tab is hidden and the user allowed notifications, also fire a system
// notification so a finished upload pings them even on another tab.
function showToast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = 'flash ' + type;
  el.textContent = message;
  el.style.top = '18px';
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s ease, transform .4s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(-8px)';
    setTimeout(() => el.remove(), 420);
  }, 3600);

  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(message); } catch (_) { /* ignore */ }
  }
}

// Ask once (on a user gesture) for permission to show a system notification,
// so a finished upload can ping the user if they've switched to another tab.
function ensureNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch (_) { /* not supported — the in-app toast still shows */ }
}

// Toast shown when an upload batch finishes: green tick on full success, a
// warning (kept as info styling) when some files failed.
function uploadDoneToast(ok, failed) {
  if (ok <= 0 && failed <= 0) return;
  const noun = (n) => n === 1 ? 'item' : 'items';
  if (failed > 0) {
    showToast(`Uploaded ${ok} ${noun(ok)} · ${failed} failed`, 'error');
  } else {
    showToast(`✅ Upload complete — ${ok} ${noun(ok)}`, 'info');
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
  function normalizeGroups(groups) {
    return groups
      .map((g) => ({ name: g.name, files: g.files.filter(isMedia).sort(byName) }))
      .filter((g) => g.files.length)
      .sort(byName);
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
        <div id="importDropTarget" style="border:2px dashed rgba(140,100,60,.45);border-radius:12px;padding:20px 16px;margin:12px 0;text-align:center;font-size:13px;opacity:.85;cursor:pointer;">
          Drop folders here, or <span style="text-decoration:underline;">click to add a folder</span>
        </div>
        <div id="importList" style="max-height:230px;overflow:auto;margin:10px 0;"></div>
        <label class="field-label" style="font-size:12px;">Add the new stories to</label>
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
    const pending = [];

    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); dlg = null; };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    function rerender() {
      if (!pending.length) {
        list.innerHTML = '<div style="opacity:.55;font-size:13px;padding:6px 2px;">No folders added yet.</div>';
      } else {
        list.innerHTML = pending.map((g, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:7px 2px;">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.name)}</span>
            <span style="opacity:.6;font-size:12px;flex-shrink:0;">${g.files.length} file${g.files.length === 1 ? '' : 's'}</span>
            <button type="button" data-rm="${i}" title="Remove" style="border:none;background:none;cursor:pointer;font-size:16px;opacity:.6;line-height:1;">×</button>
          </div>`).join('');
      }
      goBtn.disabled = !pending.length;
      goBtn.textContent = pending.length ? `Import ${pending.length} ${pending.length === 1 ? 'story' : 'stories'}` : 'Import';
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
      const groups = pending.slice();
      close();
      await importGroups(groups, folderId);
    });
    document.addEventListener('keydown', onKey);

    dlg = { pending, addGroups };
    rerender();
    if (seedGroups) addGroups(seedGroups);
  }

  // Kept name for existing drop callers — funnel into the accumulating dialog.
  function confirmAndImport(groups) { openImportDialog(groups); }

  // groups: [{ name, files }] — each becomes one private story named after the
  // folder, files in name order, first photo as the cover, filed into the
  // chosen app folder (folderId may be null).
  async function importGroups(groups, folderId) {
    const eta = makeUploadEta(groups.flatMap((g) => g.files));
    let storyNo = 0;
    const label = () => `Importing story ${storyNo}/${groups.length} · ${eta.text()}…`;
    const ticker = setInterval(() => show(label()), 1000);
    try {
      for (const g of groups) {
        storyNo += 1;
        show(label());
        let id = null;
        try {
          const createRes = await fetch('/stories/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: g.name, folder_id: folderId }),
          });
          if (createRes.ok) id = (await createRes.json()).id;
        } catch (_) { /* fall through */ }
        if (!id) { g.files.forEach((f) => eta.fileDone(f)); continue; } // skip folder, keep ETA honest

        // Upload the folder's files, 3 at a time, remembering each media id.
        const ids = new Array(g.files.length).fill(null);
        const queue = g.files.map((file, idx) => ({ file, idx }));
        const worker = async () => {
          for (let it = queue.shift(); it; it = queue.shift()) {
            const fd = new FormData();
            fd.append('file', it.file);
            fd.append('label', it.file.name.replace(/\.[^.]+$/, ''));
            try {
              const res = await postFormWithProgress(`/stories/${id}/media`, fd, (sent) => eta.progress(it.file, sent));
              if (res.ok) {
                const item = ((await res.json()).items || [])[0];
                if (item) ids[it.idx] = item.id;
              }
            } catch (_) { /* skip failed file */ }
            eta.fileDone(it.file);
          }
        };
        await Promise.all(Array.from({ length: Math.min(2, g.files.length) }, worker));

        // Uploads finish out of order — persist the by-name order.
        const order = ids.filter((x) => x != null);
        if (order.length > 1) {
          await fetch(`/stories/${id}/media/reorder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order }),
          }).catch(() => {});
        }
      }
    } finally {
      clearInterval(ticker);
    }
    show('');
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
    for (const d of entries) groups.push({ name: d.name, files: await readEntryFiles(d) });
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
    const groups = [];
    const loose = [];
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') groups.push({ name: entry.name, files: await collectDirFiles(entry) });
      else { try { loose.push(await entry.getFile()); } catch (_) { /* unreadable */ } }
    }
    if (loose.length) groups.push({ name: dir.name, files: loose });
    return groups;
  }

  // Button → open the accumulating import dialog.
  btn.addEventListener('click', () => openImportDialog());

  // Fallback <input webkitdirectory>: picks one parent folder; group each file
  // by the subfolder it sits in ("Parent/Sub/x.png" → "Sub"; files right inside
  // the parent group under the parent's name). Result goes back to whoever is
  // awaiting the picker, or opens the dialog directly.
  if (input) {
    input.addEventListener('change', async () => {
      const map = new Map();
      for (const f of Array.from(input.files || [])) {
        const seg = (f.webkitRelativePath || f.name).split('/').filter(Boolean);
        const key = seg.length > 2 ? seg[1] : seg[0];
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(f);
      }
      const groups = [...map.entries()].map(([name, files]) => ({ name, files }));
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

function formatDuration(secs) {
  secs = Math.max(1, Math.round(secs));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return secs % 60 ? `${m}m ${secs % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── Editor media: upload / remove / reorder ─────────────────────────────────
function initMedia() {
  const grid = document.getElementById('mediaGrid');
  if (!grid) return;
  const bookId = grid.dataset.book;
  const input = document.getElementById('mediaInput');
  const addBtn = document.getElementById('addMediaBtn');
  const addTile = document.getElementById('addMediaTile');

  function trigger() { input.click(); }
  if (addBtn) addBtn.addEventListener('click', trigger);
  if (addTile) addTile.addEventListener('click', trigger);

  const progress = document.getElementById('uploadProgress');
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
    ensureNotifyPermission();
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
          const good = await uploadFile(file, folderName ? { setTitle: folderName } : {}, (sent) => eta.progress(file, sent));
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
    uploadDoneToast(total - failed, failed);
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
  const folderBtn = document.getElementById('addFolderBtn');
  const folderInput = document.getElementById('folderInput');
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
    if (!name) return;
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
    if (m.kind === 'video') return `<video src="/media/${m.id}" muted preload="metadata"></video>`;
    return `<span class="media-kind">${escapeHtml((m.kind || 'file').toUpperCase())}</span>`;
  }

  function makeTile(m) {
    const el = document.createElement('div');
    el.className = 'media-tile';
    el.dataset.mediaId = m.id;
    el.innerHTML = `
      <div class="media-thumb">
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

  orderableTiles().forEach(bindTile);
  refreshOrders();
}

// ── iPhone-Photos-style pinch zoom: cycles columns 4 → 8 → 12 → 16 ──────────
function initGalleryZoom(grid) {
  const COLS = [4, 8, 12, 16];          // index 0 = most zoomed in (largest)
  let idx = COLS.indexOf(parseInt(localStorage.getItem('galleryCols'), 10));
  if (idx === -1) idx = 1;              // default: 8 per row

  const ctrl = document.getElementById('galleryZoom');
  const btnIn = ctrl && ctrl.querySelector('[data-zoom="in"]');
  const btnOut = ctrl && ctrl.querySelector('[data-zoom="out"]');

  function apply() {
    grid.style.setProperty('--gallery-cols', COLS[idx]);
    localStorage.setItem('galleryCols', COLS[idx]);
    if (btnIn) btnIn.disabled = idx === 0;
    if (btnOut) btnOut.disabled = idx === COLS.length - 1;
  }
  function zoomIn() { if (idx > 0) { idx--; apply(); } }                 // fewer, larger
  function zoomOut() { if (idx < COLS.length - 1) { idx++; apply(); } }  // more, smaller
  apply();

  if (ctrl) ctrl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (b) (b.dataset.zoom === 'in' ? zoomIn : zoomOut)();
  });

  // Trackpad pinch / Ctrl+scroll (browsers report trackpad pinch as wheel+ctrlKey)
  let wheelAcc = 0;
  grid.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (wheelAcc <= -30) { zoomIn(); wheelAcc = 0; }
    else if (wheelAcc >= 30) { zoomOut(); wheelAcc = 0; }
  }, { passive: false });

  // Two-finger touch pinch
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  let startDist = 0;
  grid.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) startDist = dist(e.touches);
  }, { passive: true });
  grid.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !startDist) return;
    e.preventDefault();                 // stop native page zoom while pinching the grid
    const ratio = dist(e.touches) / startDist;
    if (ratio > 1.35) { zoomIn(); startDist = dist(e.touches); }
    else if (ratio < 0.74) { zoomOut(); startDist = dist(e.touches); }
  }, { passive: false });
  grid.addEventListener('touchend', (e) => { if (e.touches.length < 2) startDist = 0; });
}

// ── Standalone image gallery (upload, delete, lightbox) ─────────────────────
function initGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  const input = document.getElementById('galleryInput');
  const btn = document.getElementById('galleryUploadBtn');
  const empty = document.getElementById('galleryEmpty');
  const progress = document.getElementById('galleryProgress');
  const newestFirst = grid.dataset.order !== 'oldest';
  const activeCollection = grid.dataset.collection || '';
  let collections = [];
  try { collections = JSON.parse(grid.dataset.collections || '[]'); } catch (_) { /* none */ }

  initGalleryZoom(grid);

  if (btn && input) btn.addEventListener('click', () => input.click());

  function showProgress(done, total, eta) {
    if (!progress) return;
    if (total <= 0) { progress.hidden = true; progress.textContent = ''; return; }
    progress.hidden = false;
    progress.textContent = `Uploading ${done}/${total}${eta ? ` · ${eta.text()}` : ''}…`;
  }

  function collectButton(imgId, currentId) {
    if (!collections.length) return '';
    return `<button type="button" class="tile-collect" data-collect="${imgId}" data-current="${currentId || ''}" title="Move to collection">⇄</button>`;
  }

  // Tap-friendly chooser dialog for moving a tile into a collection.
  function openCollectionChooser(imgId, currentId, onMoved) {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const opts = [{ id: '', name: 'No collection' }].concat(collections);
    backdrop.innerHTML = `
      <div class="dialog-card" role="dialog" aria-modal="true">
        <h3>Move to collection</h3>
        <div class="chooser">
          ${opts.map((c) => {
            const cur = String(c.id) === String(currentId || '');
            return `<button type="button" class="chooser-opt ${cur ? 'current' : ''}" data-id="${c.id}">${escapeHtml(c.name)}${cur ? ' ✓' : ''}</button>`;
          }).join('')}
        </div>
        <div class="dialog-actions">
          <button type="button" class="dialog-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', close);
    backdrop.querySelector('.dialog-card').addEventListener('click', (e) => e.stopPropagation());
    backdrop.querySelector('.dialog-cancel').addEventListener('click', close);
    backdrop.querySelectorAll('.chooser-opt').forEach((b) => b.addEventListener('click', async () => {
      await fetch('/gallery/' + imgId + '/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ collection_id: b.dataset.id }),
      });
      close();
      onMoved(b.dataset.id);
    }));
  }

  function addTile(img) {
    const el = document.createElement('div');
    el.className = 'gallery-tile';
    el.dataset.id = img.id;
    const isVideo = (img.mime || '').startsWith('video/');
    el.innerHTML =
      `<button type="button" class="media-remove" data-del="${img.id}" title="Remove">×</button>` +
      `<a class="media-download" href="${img.url}?download=1" download title="Download">↓</a>` +
      collectButton(img.id, activeCollection) +
      (isVideo
        ? `<video src="${img.url}" muted preload="metadata"></video><div class="media-play">▶</div>`
        : `<img src="${img.url}?w=640" data-full="${img.url}" alt="" loading="lazy">`);
    // Newest-first view shows fresh uploads at the top; oldest-first at the bottom.
    grid.insertAdjacentElement(newestFirst ? 'afterbegin' : 'beforeend', el);
    if (empty) empty.hidden = true;
  }

  if (input) {
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []).filter((f) => /^(image|video)\//.test(f.type || ''));
      if (!files.length) { input.value = ''; return; }
      ensureNotifyPermission();
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
      uploadDoneToast(uploaded, files.length - uploaded);
    });
  }

  grid.addEventListener('click', async (e) => {
    // "⇄" → chooser dialog; drop the tile from view when it leaves the
    // currently filtered collection.
    const collect = e.target.closest('[data-collect]');
    if (collect) {
      e.stopPropagation();
      const tile = collect.closest('.gallery-tile');
      openCollectionChooser(collect.dataset.collect, collect.dataset.current, (newId) => {
        collect.dataset.current = newId;
        if (activeCollection && newId !== activeCollection) {
          tile.remove();
          if (empty && !grid.querySelector('.gallery-tile')) empty.hidden = false;
        }
      });
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const tile = del.closest('.gallery-tile');
      await fetch('/gallery/' + del.dataset.del + '/delete', { method: 'POST' });
      tile.remove();
      if (empty && !grid.querySelector('.gallery-tile')) empty.hidden = false;
      return;
    }
    const clicked = e.target.closest('.gallery-tile img, .gallery-tile video');
    if (clicked) {
      const items = [...grid.querySelectorAll('.gallery-tile img, .gallery-tile video')];
      openLightbox(items.map((x) => ({ src: x.dataset.full || x.currentSrc || x.src, caption: '', kind: x.tagName === 'VIDEO' ? 'video' : 'photo' })), items.indexOf(clicked));
    }
  });
}
