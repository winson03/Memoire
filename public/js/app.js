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
function openDialog({ title, body, label, value, confirmLabel, danger, onConfirm }) {
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

  function close() { backdrop.remove(); document.removeEventListener('keydown', onKey); }
  function confirm() {
    const val = input ? input.value.trim() : true;
    if (input && !val) { input.focus(); return; }
    close();
    onConfirm(val);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && input) confirm();
  }

  backdrop.addEventListener('click', close);
  card.addEventListener('click', (e) => e.stopPropagation());
  backdrop.querySelector('.dialog-cancel').addEventListener('click', close);
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

  // Create dialogs (new folder / collection).
  document.querySelectorAll('[data-create-dialog]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openDialog({
        title: btn.dataset.title,
        label: btn.dataset.label || 'Name',
        confirmLabel: 'Create',
        onConfirm: (val) => postForm(btn.dataset.action, { name: val }),
      });
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
  function showProgress(done, total) {
    if (!progress) return;
    if (total <= 0) { progress.hidden = true; progress.textContent = ''; return; }
    progress.hidden = false;
    progress.textContent = `Uploading ${done}/${total}…`;
  }

  // Upload a list of files in order. When folderName is set, an untitled story
  // is renamed after it (mirrored on the server via set_title).
  async function uploadList(files, folderName) {
    if (!files.length) return;
    if (folderName) applyFolderTitle(folderName);
    const total = files.length;
    let done = 0;
    showProgress(done, total);
    for (const file of files) {
      showProgress(done + 1, total);
      await uploadFile(file, folderName ? { setTitle: folderName } : {});
      done += 1;
    }
    showProgress(0, 0);
    refreshOrders();
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
  // untitled story after the folder. NOTE: the browser shows its own (un-
  // styleable) "Upload N files to this site?" prompt for folder picking; drag a
  // folder onto the panel instead to skip it.
  const folderBtn = document.getElementById('addFolderBtn');
  const folderInput = document.getElementById('folderInput');
  if (folderBtn && folderInput) folderBtn.addEventListener('click', () => folderInput.click());
  if (folderInput) {
    folderInput.addEventListener('change', async () => {
      const all = Array.from(folderInput.files || []);
      const images = sortByName(all.filter((f) => (f.type || '').startsWith('image/')));
      await uploadList(images, folderNameOf(all[0]));
      folderInput.value = '';
    });
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

  // Drag-and-drop folder upload. Dropping a folder reads its files directly via
  // the entries API, which (unlike folder picking) shows no browser prompt.
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

  async function uploadFile(file, opts = {}) {
    const tile = makeUploadingTile(file);
    grid.insertBefore(tile, addTile);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', file.name.replace(/\.[^.]+$/, ''));
    if (opts.setTitle) fd.append('set_title', opts.setTitle);
    try {
      const res = await fetch(`/stories/${bookId}/media`, { method: 'POST', body: fd });
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
    } catch (err) {
      tile.classList.remove('uploading');
      tile.classList.add('failed');
      const nameEl = tile.querySelector('.media-name');
      const msg = (err && err.message) ? err.message.replace(/^Upload failed:\s*/, '') : 'Upload failed';
      if (nameEl) { nameEl.textContent = msg; nameEl.title = msg; }
      setTimeout(() => tile.remove(), 4000);
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
    if (m.kind === 'photo') return `<img src="/media/${m.id}" alt="" draggable="false">`;
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

  initGalleryZoom(grid);

  if (btn && input) btn.addEventListener('click', () => input.click());

  function showProgress(done, total) {
    if (!progress) return;
    if (total <= 0) { progress.hidden = true; progress.textContent = ''; return; }
    progress.hidden = false;
    progress.textContent = `Uploading ${done}/${total}…`;
  }

  function addTile(img) {
    const el = document.createElement('div');
    el.className = 'gallery-tile';
    el.dataset.id = img.id;
    const isVideo = (img.mime || '').startsWith('video/');
    el.innerHTML =
      `<button type="button" class="media-remove" data-del="${img.id}" title="Remove">×</button>` +
      `<a class="media-download" href="${img.url}?download=1" download title="Download">↓</a>` +
      (isVideo
        ? `<video src="${img.url}" muted preload="metadata"></video><div class="media-play">▶</div>`
        : `<img src="${img.url}" alt="" loading="lazy">`);
    // Newest-first view shows fresh uploads at the top; oldest-first at the bottom.
    grid.insertAdjacentElement(newestFirst ? 'afterbegin' : 'beforeend', el);
    if (empty) empty.hidden = true;
  }

  if (input) {
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []).filter((f) => /^(image|video)\//.test(f.type || ''));
      let done = 0;
      showProgress(done, files.length);
      for (const file of files) {
        showProgress(done + 1, files.length);
        const fd = new FormData();
        fd.append('file', file);
        try {
          const res = await fetch('/gallery', { method: 'POST', body: fd });
          if (res.ok) addTile(await res.json());
        } catch (_) { /* skip failed file */ }
        done += 1;
      }
      showProgress(0, 0);
      input.value = '';
    });
  }

  grid.addEventListener('click', async (e) => {
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
      openLightbox(items.map((x) => ({ src: x.currentSrc || x.src, caption: '', kind: x.tagName === 'VIDEO' ? 'video' : 'photo' })), items.indexOf(clicked));
    }
  });
}
