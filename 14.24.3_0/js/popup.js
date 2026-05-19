// Toolbar popup: profile switch + preview + Auto-Learn.
(function () {
  'use strict';

  var FIELDS_KEY = 'fieldProfiles';
  var CATS_KEY = 'fieldCategories';
  var ACTIVE_CAT_KEY = 'activeCategory';
  var LEARN_KEY = 'autoLearnEnabled';

  var $ = function (id) { return document.getElementById(id); };
  var sel = $('popup-profile');
  var status = $('popup-status');
  var previewBtn = $('popup-preview');
  var learnToggle = $('popup-learn-toggle');
  var learnCount  = $('popup-learn-count');
  var learnSave   = $('popup-learn-save');

  var previewActive = false;

  function setStatus(msg, sticky) {
    status.textContent = msg || '';
    if (msg && !sticky) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(function () { status.textContent = ''; }, 2000);
    }
  }

  function collectProfiles(catsList, fields) {
    var set = Object.create(null), order = [];
    function add(name) {
      var n = String(name == null ? '' : name).trim();
      if (!n || set[n]) return; set[n] = true; order.push(n);
    }
    if (Array.isArray(catsList)) catsList.forEach(add);
    if (Array.isArray(fields)) fields.forEach(function (f) { if (f) add(f.category); });
    return order;
  }

  function buildOptions(profiles, active) {
    sel.textContent = '';
    var optAll = document.createElement('option');
    optAll.value = 'all'; optAll.textContent = 'All profiles'; sel.appendChild(optAll);
    var optDef = document.createElement('option');
    optDef.value = ''; optDef.textContent = '(Uncategorized)'; sel.appendChild(optDef);
    for (var i = 0; i < profiles.length; i++) {
      var o = document.createElement('option');
      o.value = profiles[i]; o.textContent = profiles[i]; sel.appendChild(o);
    }
    var allowed = ['all', ''].concat(profiles);
    sel.value = allowed.indexOf(active) === -1 ? 'all' : active;
  }

  function loadProfiles() {
    chrome.storage.local.get([FIELDS_KEY, CATS_KEY, ACTIVE_CAT_KEY], function (data) {
      var profiles = collectProfiles(data[CATS_KEY], data[FIELDS_KEY]);
      buildOptions(profiles, data[ACTIVE_CAT_KEY] || 'all');
    });
  }

  sel.addEventListener('change', function () {
    var v = sel.value === 'all' ? '' : sel.value;
    var update = { activeCategory: sel.value === 'all' ? '' : v };
    update[ACTIVE_CAT_KEY] = sel.value === 'all' ? '' : v;
    chrome.storage.local.set(update);
  });

  $('popup-fill').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) return;
      chrome.tabs.sendMessage(tab.id, { action: 'exe_active_cat' });
      setStatus('Autofilling…');
    });
  });

  $('popup-manage').addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL('options.html'));
  });

  // ---------- preview ----------
  function setPreviewState(on) {
    previewActive = !!on;
    previewBtn.setAttribute('aria-pressed', previewActive ? 'true' : 'false');
    previewBtn.textContent = previewActive ? 'Clear preview' : 'Preview matches';
  }

  previewBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) return;
      if (previewActive) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          func: function () { if (window.__nfillPreviewClear) window.__nfillPreviewClear(); }
        }, function () { setPreviewState(false); setStatus('Preview cleared'); });
        return;
      }
      chrome.storage.local.get([FIELDS_KEY, ACTIVE_CAT_KEY], function (data) {
        var fields = Array.isArray(data[FIELDS_KEY]) ? data[FIELDS_KEY] : [];
        var activeCat = sel.value;
        var rules = fields.filter(function (f) {
          if (!f) return false;
          if (activeCat === 'all') return true;
          return String(f.category || '') === String(activeCat || '');
        });
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: ['js/preview-overlay.js']
        }, function () {
          chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: false },
            func: function (r) { if (window.__nfillPreviewBuild) return window.__nfillPreviewBuild(r); return 0; },
            args: [rules]
          }, function (results) {
            var n = (results && results[0] && results[0].result) || 0;
            setPreviewState(true);
            setStatus(n + ' match' + (n === 1 ? '' : 'es'));
          });
        });
      });
    });
  });

  // ---------- auto-learn ----------
  function refreshLearnCount() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) { learnCount.textContent = '0 pending'; learnSave.disabled = true; return; }
      chrome.tabs.sendMessage(tab.id, { action: 'auto_learn_count' }, function (resp) {
        var n = (resp && typeof resp.count === 'number') ? resp.count : 0;
        learnCount.textContent = n + ' pending';
        learnSave.disabled = n === 0;
      });
    });
  }

  chrome.storage.local.get([LEARN_KEY], function (data) {
    learnToggle.checked = data[LEARN_KEY] !== false;
  });

  learnToggle.addEventListener('change', function () {
    var update = {};
    update[LEARN_KEY] = !!learnToggle.checked;
    chrome.storage.local.set(update);
  });

  learnSave.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) return;
      chrome.tabs.sendMessage(tab.id, { action: 'auto_learn_flush' }, function (resp) {
        var added = (resp && typeof resp.added === 'number') ? resp.added : 0;
        setStatus(added > 0 ? ('Saved ' + added + ' rule' + (added === 1 ? '' : 's')) : 'Nothing to save');
        loadProfiles();
        refreshLearnCount();
      });
    });
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.action === 'auto_learn_flushed') {
      loadProfiles();
      refreshLearnCount();
    }
  });

  loadProfiles();
  refreshLearnCount();
})();
