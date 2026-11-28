(function () {
  var $ = function (id) { return document.getElementById(id); };
  var status = $('status');
  function say(t, cls) { status.textContent = t; status.className = cls || ''; }
  function server() { return ($('server').value || '').trim().replace(/\/+$/, ''); }
  function syncKeyLink() { $('getKey').href = (server() || self.MEMOIRE_SERVER) + '/import#key'; }

  async function loadFolders(srv, token, selected) {
    var r = await fetch(srv + '/import/api/folders', { headers: { Authorization: 'Bearer ' + token } });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || ('Server said ' + r.status));
    var sel = $('folder');
    sel.innerHTML = '<option value="">No folder</option>';
    (d.folders || []).forEach(function (f) {
      var o = document.createElement('option');
      o.value = f.id; o.textContent = (f.fav ? '★ ' : '') + f.name;
      sel.appendChild(o);
    });
    sel.value = selected ? String(selected) : '';
  }

  $('ver').textContent = 'Version ' + chrome.runtime.getManifest().version;
  chrome.runtime.sendMessage({ type: 'update-info' }, function (d) {
    if (!d || !d.update) return;
    $('newVer').textContent = 'v' + d.update.version + ' (you have v' + d.current + ')';
    $('dl').href = d.update.download;
    $('update').hidden = false;
  });

  chrome.storage.local.get(['server', 'token', 'folderId'], function (s) {
    $('server').value = s.server || self.MEMOIRE_SERVER || '';
    $('token').value = s.token || '';
    syncKeyLink();
    if (s.token) loadFolders(server(), s.token, s.folderId).then(function () { say('Connected.', 'ok'); }).catch(function (e) { say(e.message, 'err'); });
  });
  $('server').addEventListener('input', syncKeyLink);

  $('save').addEventListener('click', async function () {
    var srv = server(); var token = ($('token').value || '').trim();
    if (!srv || !token) return say('Fill in the address and your key.', 'err');
    say('Checking…');
    try {
      var r = await fetch(srv + '/import/api/ping', { headers: { Authorization: 'Bearer ' + token } });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || ('Server said ' + r.status));
      var keepFolder = $('folder').value;
      await loadFolders(srv, token, keepFolder);
      await chrome.storage.local.set({ server: srv, token: token, folderId: $('folder').value ? Number($('folder').value) : null });
      say('Connected as ' + (d.name || 'you') + '. You’re all set.', 'ok');
    } catch (e) {
      say(e.message || 'Could not connect.', 'err');
    }
  });
  $('folder').addEventListener('change', function () {
    chrome.storage.local.set({ folderId: $('folder').value ? Number($('folder').value) : null });
    say('Folder saved.', 'ok');
  });
})();
