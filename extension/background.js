// Save to Mémoire — background: talks to your Mémoire server.
importScripts('config.js');

async function cfg() {
  const s = await chrome.storage.local.get(['server', 'token', 'folderId']);
  return { server: (s.server || self.MEMOIRE_SERVER || '').replace(/\/+$/, ''), token: s.token || '', folderId: s.folderId || null };
}

async function api(path, body, method) {
  const c = await cfg();
  if (!c.token) {
    chrome.runtime.openOptionsPage();
    return { error: 'Add your import key first (the setup page just opened).' };
  }
  if (body && typeof body === 'object' && !('folder_id' in body)) body.folder_id = c.folderId;
  try {
    const r = await fetch(c.server + '/import/api' + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: Object.assign({ Authorization: 'Bearer ' + c.token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && !d.error) d.error = 'Server error (' + r.status + ')';
    return d;
  } catch (e) {
    return { error: 'Could not reach Mémoire — check the server address in the extension setup.' };
  }
}

// ── Update check ─────────────────────────────────────────────────────────────
// Unpacked extensions never update themselves, so compare with the version the
// server ships and show a NEW badge (and a note on the setup page) when behind.
function newer(a, b) {
  const pa = String(a || '').split('.').map(Number); const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function showUpdateBadge() {
  const { update } = await chrome.storage.local.get('update');
  if (update && newer(update.version, chrome.runtime.getManifest().version)) {
    chrome.action.setBadgeBackgroundColor({ color: '#C2683E' });
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setTitle({ title: 'Update available: v' + update.version + ' — right-click this icon → Setup & updates' });
  } else {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Save this page to Mémoire' });
  }
}

async function checkForUpdate() {
  const c = await cfg();
  if (!c.server) return;
  try {
    const r = await fetch(c.server + '/import/extension-version.json', { cache: 'no-store' });
    const d = await r.json();
    const mine = chrome.runtime.getManifest().version;
    await chrome.storage.local.set({
      update: d.version && newer(d.version, mine) ? { version: d.version, download: c.server + d.download, page: c.server + d.page } : null,
      updateCheckedAt: Date.now(),
    });
  } catch (_) { /* offline — try again later */ }
  showUpdateBadge();
}

chrome.alarms.create('update-check', { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'update-check') checkForUpdate(); });
chrome.runtime.onStartup.addListener(checkForUpdate);

function badge(tabId, ok, text) {
  const opts = tabId ? { tabId } : {};
  chrome.action.setBadgeBackgroundColor(Object.assign({ color: ok ? '#5a9a63' : '#c2583e' }, opts));
  chrome.action.setBadgeText(Object.assign({ text: ok ? '✓' : '!' }, opts));
  setTimeout(() => {
    // null clears the per-tab badge so the global one (e.g. NEW) shows again.
    if (tabId) chrome.action.setBadgeText({ tabId, text: null });
    else chrome.action.setBadgeText({ text: '' });
    showUpdateBadge();
  }, 4000);
}

// Tell the page (if it has our script) to show a toast; otherwise use the badge.
function notify(tabId, d) {
  const ok = !d.error;
  badge(tabId, ok, d.error || d.message);
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'toast', ok, text: d.error || d.message || 'Saving…' }).catch(() => {});
}

function sourceFor(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (/(^|\.)x\.com$|twitter\.com$/.test(h)) return 'X';
    if (/patreon\.com$/.test(h)) return 'Patreon';
    return h;
  } catch (_) { return 'the web'; }
}

chrome.runtime.onInstalled.addListener(async (info) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'media', title: 'Save to Mémoire', contexts: ['image', 'video'] });
    chrome.contextMenus.create({ id: 'link', title: 'Save linked post to Mémoire', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'page', title: 'Save this page to Mémoire', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'setup', title: 'Setup & updates', contexts: ['action'] });
  });
  const c = await cfg();
  if (info.reason === 'install' || !c.token) chrome.runtime.openOptionsPage();
  checkForUpdate();
});

async function savePage(tab) {
  if (!tab || !tab.url) return;
  if (/^https:\/\/(www\.)?patreon\.com\//.test(tab.url)) {
    // Patreon needs your signed-in session — the page script does the work.
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'patreon-save-page' }).catch(() => null);
    if (!r) notify(tab.id, { error: 'Reload the Patreon page and try again.' });
    return;
  }
  notify(tab.id, await api('/link', { link: tab.url }));
}

chrome.action.onClicked.addListener(savePage);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab && tab.id;
  if (info.menuItemId === 'setup') return chrome.runtime.openOptionsPage();
  if (info.menuItemId === 'page') return savePage(tab);
  if (info.menuItemId === 'link') return notify(tabId, await api('/link', { link: info.linkUrl }));
  if (info.menuItemId === 'media') {
    const src = info.srcUrl || '';
    // Streamed videos (blob:) can't be fetched directly — save the post instead.
    if (!/^https?:/.test(src)) return notify(tabId, await api('/link', { link: info.pageUrl }));
    let url = src;
    const m = src.match(/^https:\/\/pbs\.twimg\.com\/media\/([\w-]+)/);
    if (m) {
      const fmt = (new URL(src).searchParams.get('format')) || 'jpg';
      url = 'https://pbs.twimg.com/media/' + m[1] + '?format=' + fmt + '&name=orig';
    }
    return notify(tabId, await api('/urls', { source: sourceFor(info.pageUrl || src), link: info.pageUrl, items: [{ url }] }));
  }
});

// Calls from the page scripts (X / Patreon buttons).
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'api') {
    api(msg.path, msg.body).then((d) => {
      badge(sender.tab && sender.tab.id, !d.error, d.error || d.message);
      reply(d);
    });
    return true;
  }
  if (msg && msg.type === 'cfg') { cfg().then(reply); return true; }
  if (msg && msg.type === 'update-info') {
    chrome.storage.local.get(['update', 'updateCheckedAt']).then(async (s) => {
      // Re-check if the last check is over an hour old.
      if (!s.updateCheckedAt || Date.now() - s.updateCheckedAt > 3600e3) { await checkForUpdate(); s = await chrome.storage.local.get(['update']); }
      const u = s.update && newer(s.update.version, chrome.runtime.getManifest().version) ? s.update : null;
      reply({ update: u, current: chrome.runtime.getManifest().version });
    });
    return true;
  }
  if (msg && msg.type === 'open-options') { chrome.runtime.openOptionsPage(); return false; }
  return false;
});
