// X / Twitter: a "Save" button on every post that has photos or videos.
(function () {
  var M = window.__memoire;
  var MEDIA = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], video, img[src*="pbs.twimg.com/media/"]';

  function statusLink(article) {
    var t = article.querySelector('a[href*="/status/"] time');
    var a = t && t.closest('a');
    if (!a) {
      var m = location.pathname.match(/^\/[^/]+\/status\/\d+/);
      return m ? location.origin + m[0] : null;
    }
    var p = new URL(a.href).pathname.match(/^\/[^/]+\/status\/\d+/);
    return p ? 'https://x.com' + p[0] : null;
  }

  function domPhotos(article) {
    var seen = {};
    var out = [];
    article.querySelectorAll('img[src*="pbs.twimg.com/media/"]').forEach(function (img) {
      var m = img.src.match(/^https:\/\/pbs\.twimg\.com\/media\/([\w-]+)/);
      if (!m || seen[m[1]]) return;
      seen[m[1]] = 1;
      var fmt = new URL(img.src).searchParams.get('format') || 'jpg';
      out.push({ url: 'https://pbs.twimg.com/media/' + m[1] + '?format=' + fmt + '&name=orig' });
    });
    return out;
  }

  async function save(article, btn) {
    var link = statusLink(article);
    if (!link) return M.toast('Could not find this post’s link.', false);
    M.busy(btn, true, 'Saving…');
    var d = await M.call('/link', { link: link });
    if (d.error && !/import key|reach Mémoire|reload/i.test(d.error)) {
      // Sensitive / protected posts: fall back to the photos visible on screen.
      var photos = domPhotos(article);
      if (photos.length) d = await M.call('/urls', { source: 'X', link: link, items: photos });
      if (!d.error && article.querySelector('video')) d.message += ' (this post’s video could not be saved)';
    }
    M.busy(btn, false, d.error ? 'Save' : 'Saved ✓');
    M.toast(d.error || d.message, !d.error);
  }

  function decorate(article) {
    if (article.dataset.memoire) return;
    if (!article.querySelector(MEDIA)) return;
    var bar = article.querySelectorAll('[role="group"]');
    bar = bar[bar.length - 1];
    if (!bar) return;
    article.dataset.memoire = '1';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;margin-left:8px;';
    var btn = M.button('Save');
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); save(article, btn); });
    wrap.appendChild(btn);
    bar.appendChild(wrap);
  }

  function scan() { document.querySelectorAll('article[data-testid="tweet"]').forEach(decorate); }
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
