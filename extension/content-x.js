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
    article.dataset.memoire = '1';
    var wrap = document.createElement('div');
    wrap.className = 'memoire-save-wrap';
    wrap.style.cssText = 'display:flex;align-items:center;flex:none;margin-left:8px;';
    var btn = M.button('Save');
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); save(article, btn); });
    wrap.appendChild(btn);
    // Normally in the reply/repost/like row; if X changes that row, put it
    // under the photos instead so it is never missing.
    var bars = article.querySelectorAll('[role="group"]');
    var bar = bars[bars.length - 1];
    if (bar) { bar.appendChild(wrap); return; }
    var media = article.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]');
    var host = (media && media.closest('div[aria-labelledby]')) || media && media.parentElement || article;
    wrap.style.margin = '8px 0';
    host.parentElement ? host.parentElement.insertBefore(wrap, host.nextSibling) : article.appendChild(wrap);
  }

  // Single post page: a floating button too, saving the post in the address bar.
  var floating = null;
  function syncFloating() {
    var onPost = /^\/[^/]+\/status\/\d+/.test(location.pathname);
    if (onPost && !floating) {
      floating = M.button('Save to Mémoire');
      floating.style.position = 'fixed';
      floating.style.right = '20px';
      floating.style.bottom = '76px';
      floating.style.zIndex = '2147483646';
      floating.style.height = '36px';
      floating.style.padding = '0 16px';
      floating.addEventListener('click', function () {
        var main = document.querySelector('article[data-testid="tweet"]');
        if (main) return save(main, floating);
        M.busy(floating, true, 'Saving…');
        M.call('/link', { link: location.href }).then(function (d) {
          M.busy(floating, false, d.error ? 'Save to Mémoire' : 'Saved ✓');
          M.toast(d.error || d.message, !d.error);
        });
      });
      document.documentElement.appendChild(floating);
    } else if (!onPost && floating) {
      floating.remove(); floating = null;
    }
    if (floating && onPost && floating.textContent === 'Saved ✓' && floating.dataset.path !== location.pathname) floating.textContent = 'Save to Mémoire';
    if (floating) floating.dataset.path = location.pathname;
  }

  function scan() {
    syncFloating();
    document.querySelectorAll('article[data-testid="tweet"], article[role="article"]').forEach(decorate);
  }
  console.info('[Mémoire] Save buttons ready on X');
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
