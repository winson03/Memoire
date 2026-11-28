// Patreon: uses your signed-in session to list a post's photos, videos and
// attachments, then hands them to Mémoire. Works on single post pages
// (floating button) and on creator feeds (a button on each post card).
(function () {
  var M = window.__memoire;

  function postIdFrom(href) {
    var m = String(href || '').match(/\/posts\/(?:[^/?#]*-)?(\d+)/);
    return m ? m[1] : null;
  }

  async function postMedia(id) {
    var url = '/api/posts/' + id + '?include=images,media,attachments_media,attachments' +
      '&fields[post]=title,post_type,post_file,image,url' +
      '&fields[media]=download_url,image_urls,file_name,mimetype,media_type' +
      '&json-api-version=1.0';
    var r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/vnd.api+json' } });
    if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? 'You don’t have access to this post.' : 'Patreon said ' + r.status);
    var d = await r.json();
    var post = d.data && d.data.attributes || {};
    var out = []; var seen = {}; var streamOnly = 0;
    function add(u, name, mime) {
      if (!u || seen[u]) return;
      if (/\.m3u8|stream\.mux\.com/i.test(u)) { streamOnly += 1; return; }
      if (mime && !/^(image|video)\//.test(mime)) return;
      if (!mime && name && !/\.(jpe?g|png|gif|webp|avif|heic|mp4|m4v|mov|webm)$/i.test(name)) return;
      seen[u] = 1;
      out.push({ url: u, name: name || null });
    }
    if (post.post_file && post.post_file.url) add(post.post_file.url, post.post_file.name, null);
    (d.included || []).forEach(function (it) {
      var a = it.attributes || {};
      if (it.type === 'media') {
        var iu = a.image_urls || {};
        add(a.download_url || iu.original || iu.url || iu.default, a.file_name, a.mimetype || null);
      } else if (it.type === 'attachment') {
        add(a.url, a.name, null);
      }
    });
    return { items: out, streamOnly: streamOnly, title: post.title || '', link: post.url || location.href };
  }

  // Patreon's own /file links only open with your login, so this browser
  // downloads those and uploads the bytes; CDN links the server fetches itself.
  async function uploadBlob(item, link) {
    var c = await M.getCfg();
    var r = await fetch(item.url, { credentials: 'include' });
    if (!r.ok) throw new Error('download ' + r.status);
    var blob = await r.blob();
    var fd = new FormData();
    fd.append('source', 'Patreon');
    fd.append('link', link);
    // /file?h=…&i=<id>: key on the id, since every attachment shares the path.
    fd.append('source_url', 'https://www.patreon.com/file/' + encodeURIComponent(new URL(item.url).searchParams.get('i') || item.url));
    if (c.folderId) fd.append('folder_id', c.folderId);
    fd.append('file', blob, item.name || 'patreon-file');
    var up = await fetch(c.server + '/import/api/file', { method: 'POST', headers: { Authorization: 'Bearer ' + c.token }, body: fd });
    var d = await up.json().catch(function () { return {}; });
    if (!up.ok || d.error) throw new Error(d.error || ('upload ' + up.status));
    return d;
  }

  async function save(id, btn) {
    if (!id) return M.toast('Open a post first.', false);
    if (btn) M.busy(btn, true, 'Saving…');
    var result = { error: null, message: '' };
    try {
      var p = await postMedia(id);
      var direct = p.items.filter(function (i) { return !/^https:\/\/(www\.)?patreon\.com\//.test(i.url); });
      var gated = p.items.filter(function (i) { return /^https:\/\/(www\.)?patreon\.com\//.test(i.url); });
      if (!direct.length && !gated.length) {
        throw new Error(p.streamOnly ? 'This post’s video is streaming-only, so it can’t be saved.' : 'No photos or videos on this post.');
      }
      var n = 0;
      if (direct.length) {
        var d = await M.call('/urls', { source: 'Patreon', link: p.link, items: direct });
        if (d.error) throw new Error(d.error);
        n += direct.length;
      }
      if (gated.length) M.toast('Uploading ' + gated.length + ' attachment' + (gated.length > 1 ? 's' : '') + '…', null);
      for (var i = 0; i < gated.length; i++) {
        try { await uploadBlob(gated[i], p.link); n += 1; } catch (e) { console.warn('[Mémoire]', e); }
      }
      if (!n) throw new Error('Could not save this post’s files.');
      result.message = 'Saving ' + n + ' item' + (n > 1 ? 's' : '') + ' from Patreon…' + (p.streamOnly ? ' (' + p.streamOnly + ' streaming video skipped)' : '');
    } catch (e) {
      result.error = e.message || 'Something went wrong.';
    }
    if (btn) M.busy(btn, false, result.error ? 'Save' : 'Saved ✓');
    M.toast(result.error || result.message, !result.error);
    return result;
  }

  // Toolbar icon / "Save this page" menu.
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (msg && msg.type === 'patreon-save-page') {
      var id = postIdFrom(location.pathname);
      if (!id) { M.toast('Open a single Patreon post, or use the Save button on a post.', false); reply({ ok: false }); return false; }
      save(id, floating).then(function () { reply({ ok: true }); });
      return true;
    }
    return false;
  });

  // Floating button on /posts/… pages.
  var floating = null;
  function syncFloating() {
    var id = postIdFrom(location.pathname);
    if (id && !floating) {
      floating = M.button('Save to Mémoire');
      floating.style.position = 'fixed';
      floating.style.right = '20px';
      floating.style.bottom = '76px';
      floating.style.zIndex = '2147483646';
      floating.style.height = '36px';
      floating.style.padding = '0 16px';
      floating.addEventListener('click', function () { save(postIdFrom(location.pathname), floating); });
      document.documentElement.appendChild(floating);
    } else if (!id && floating) {
      floating.remove(); floating = null;
    }
  }

  // A button on each post card in feeds.
  function decorate(card) {
    if (card.dataset.memoire) return;
    var a = card.querySelector('a[href*="/posts/"]');
    var id = a && postIdFrom(a.getAttribute('href'));
    if (!id) return;
    card.dataset.memoire = '1';
    var btn = M.button('Save');
    btn.style.margin = '8px 0 0';
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); save(id, btn); });
    var anchor = card.querySelector('[data-tag="post-title"]');
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(btn, anchor.nextSibling);
    else card.insertBefore(btn, card.firstChild);
  }

  function scan() {
    syncFloating();
    document.querySelectorAll('[data-tag="post-card"]').forEach(decorate);
  }
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; scan(); }, 300);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
