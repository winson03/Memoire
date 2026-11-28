// Shared by the page scripts: a small toast and a call into the background.
(function () {
  if (window.__memoire) return;
  var box = null; var timer = null;
  function toast(text, ok) {
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('role', 'status');
      box.style.cssText = 'position:fixed;z-index:2147483647;right:20px;bottom:20px;max-width:340px;padding:12px 16px;border-radius:12px;font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .2s;color:#fff;';
      document.documentElement.appendChild(box);
    }
    box.textContent = text;
    box.style.background = ok === false ? '#b24a32' : (ok === null ? '#3A322A' : '#3f7a4a');
    box.style.opacity = '1';
    clearTimeout(timer);
    timer = setTimeout(function () { box.style.opacity = '0'; }, ok === null ? 8000 : 4500);
  }
  function call(path, body) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'api', path: path, body: body }, function (d) {
          resolve(d || { error: 'The extension was updated — reload this page.' });
        });
      } catch (e) { resolve({ error: 'The extension was updated — reload this page.' }); }
    });
  }
  function getCfg() {
    return new Promise(function (resolve) { chrome.runtime.sendMessage({ type: 'cfg' }, resolve); });
  }
  // A small pill button in the Mémoire colours.
  function button(label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'memoire-save-btn';
    b.textContent = label || 'Save';
    b.title = 'Save to Mémoire';
    b.style.cssText = 'all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:999px;background:linear-gradient(135deg,#C2683E,#E0A054);color:#FFF8F0;font:700 12.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 3px 10px rgba(194,104,62,.3);white-space:nowrap;';
    b.addEventListener('mouseenter', function () { b.style.filter = 'brightness(1.07)'; });
    b.addEventListener('mouseleave', function () { b.style.filter = ''; });
    return b;
  }
  function busy(b, on, label) {
    b.disabled = !!on;
    b.style.opacity = on ? '.6' : '';
    b.style.pointerEvents = on ? 'none' : '';
    if (label) b.textContent = label;
  }
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'toast') toast(msg.text, msg.ok);
  });
  window.__memoire = { toast: toast, call: call, getCfg: getCfg, button: button, busy: busy };
})();
