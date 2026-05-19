// Toolbar popup: switch active profile + preview matches on the current page.
(function () {
  'use strict';

  var FIELDS_KEY = 'fieldProfiles';
  var CATS_KEY = 'fieldCategories';
  var ACTIVE_CAT_KEY = 'activeCategory';

  var $ = function (id) { return document.getElementById(id); };
  var sel = $('popup-profile');
  var status = $('popup-status');
  var previewBtn = $('popup-preview');

  var previewActive = false;

  function setStatus(msg, sticky) {
    status.textContent = msg || '';
    if (msg && !sticky) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(function () { status.textContent = ''; }, 1800);
    }
  }

  function collectProfiles(catsList, fields) {
    var set = Object.create(null);
    var order = [];
    function add(name) {
      var n = String(name == null ? '' : name).trim();
      if (!n || set[n]) return;
      set[n] = true; order.push(n);
    }
    if (Array.isArray(catsList)) catsList.forEach(add);
    if (Array.isArray(fields)) fields.forEach(function (f) { if (f) add(f.category); });
    return order;
  }

  function buildOptions(profiles, active) {
    sel.textContent = '';
    var optAll = document.createElement('option');
    optAll.value = 'all'; optAll.textContent = 'All profiles';
    sel.appendChild(optAll);
    var optDef = document.createElement('option');
    optDef.value = ''; optDef.textContent = '(Uncategorized)';
    sel.appendChild(optDef);
    for (var i = 0; i < profiles.length; i++) {
      var o = document.createElement('option');
      o.value = profiles[i]; o.textContent = profiles[i];
      sel.appendChild(o);
    }
    var allowed = ['all', ''].concat(profiles);
    sel.value = allowed.indexOf(active) === -1 ? 'all' : active;
  }

  function load(cb) {
    if (!(chrome && chrome.storage && chrome.storage.local)) { cb && cb({}); return; }
    chrome.storage.local.get([FIELDS_KEY, CATS_KEY, ACTIVE_CAT_KEY], function (data) {
      var profiles = collectProfiles(data[CATS_KEY] || [], data[FIELDS_KEY] || []);
      var active = typeof data[ACTIVE_CAT_KEY] === 'string' ? data[ACTIVE_CAT_KEY] : 'all';
      buildOptions(profiles, active);
      cb && cb({ fields: data[FIELDS_KEY] || [], active: active });
    });
  }

  function withActiveTab(fn) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (tab && tab.id != null) fn(tab);
    });
  }

  function injectAndRun(tabId, fields, activeCategory, action) {
    chrome.scripting.executeScript(
      { target: { tabId: tabId, allFrames: false }, files: ['js/preview-overlay.js'] },
      function () {
        if (chrome.runtime.lastError) {
          setStatus('Preview unavailable on this page');
          return;
        }
        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: false },
          func: function (rules, active, op) {
            if (!window.__nfillPreview) return -1;
            if (op === 'hide') { window.__nfillPreview.hide(); return 0; }
            return window.__nfillPreview.show(rules, active);
          },
          args: [fields, activeCategory, action]
        }, function (results) {
          if (chrome.runtime.lastError) {
            setStatus('Preview blocked on this page');
            return;
          }
          if (action === 'show') {
            var count = (results && results[0] && typeof results[0].result === 'number') ? results[0].result : 0;
            setStatus(count + ' field' + (count === 1 ? '' : 's') + ' will be filled', true);
          }
        });
      }
    );
  }

  function showPreview() {
    chrome.storage.local.get([FIELDS_KEY, ACTIVE_CAT_KEY], function (data) {
      var fields = data[FIELDS_KEY] || [];
      var active = typeof data[ACTIVE_CAT_KEY] === 'string' ? data[ACTIVE_CAT_KEY] : 'all';
      withActiveTab(function (tab) { injectAndRun(tab.id, fields, active, 'show'); });
    });
  }

  function hidePreview() {
    withActiveTab(function (tab) { injectAndRun(tab.id, [], 'all', 'hide'); });
  }

  function setPreviewActive(on) {
    previewActive = !!on;
    previewBtn.setAttribute('aria-pressed', previewActive ? 'true' : 'false');
    previewBtn.textContent = previewActive ? 'Hide preview' : 'Preview matches';
    if (previewActive) showPreview(); else { hidePreview(); setStatus(''); }
  }

  sel.addEventListener('change', function () {
    var v = sel.value;
    chrome.storage.local.set({ activeCategory: v }, function () {
      var label = v === 'all' ? 'All profiles' : (v === '' ? '(Uncategorized)' : v);
      setStatus('Switched to: ' + label);
      if (previewActive) showPreview(); // refresh highlights for new profile
    });
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[FIELDS_KEY] || changes[CATS_KEY] || changes[ACTIVE_CAT_KEY]) load();
  });

  previewBtn.addEventListener('click', function () { setPreviewActive(!previewActive); });

  $('popup-fill').addEventListener('click', function () {
    if (previewActive) hidePreview();
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'exe_active_cat' }, function () { /* ignore */ });
    }
    try {
      withActiveTab(function (tab) {
        if (chrome.tabs.sendMessage) chrome.tabs.sendMessage(tab.id, { action: 'exe_active_cat' });
      });
    } catch (e) {}
    setStatus('Autofilling…');
  });

  $('popup-manage').addEventListener('click', function () {
    var url = chrome.runtime.getURL('options.html#fields');
    if (chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: url });
    else if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    window.close();
  });

  load();
})();
