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

  // ---------- profile dropdown ----------
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
      var profiles = collectProfiles(data[CATS_KEY] || [], data[FIELDS_KEY] || []);
      var active = typeof data[ACTIVE_CAT_KEY] === 'string' ? data[ACTIVE_CAT_KEY] : 'all';
      buildOptions(profiles, active);
    });
  }

  function withActiveTab(fn) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (tab && tab.id != null) fn(tab);
    });
  }

  // ---------- preview (unchanged behavior) ----------
  function injectAndRun(tabId, fields, activeCategory, action) {
    chrome.scripting.executeScript(
      { target: { tabId: tabId, allFrames: false }, files: ['js/preview-overlay.js'] },
      function () {
        if (chrome.runtime.lastError) { setStatus('Preview unavailable on this page'); return; }
        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: false },
          func: function (rules, active, op) {
            if (!window.__nfillPreview) return -1;
            if (op === 'hide') { window.__nfillPreview.hide(); return 0; }
            return window.__nfillPreview.show(rules, active);
          },
          args: [fields, activeCategory, action]
        }, function (results) {
          if (chrome.runtime.lastError) { setStatus('Preview blocked on this page'); return; }
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
  function hidePreview() { withActiveTab(function (tab) { injectAndRun(tab.id, [], 'all', 'hide'); }); }
  function setPreviewActive(on) {
    previewActive = !!on;
    previewBtn.setAttribute('aria-pressed', previewActive ? 'true' : 'false');
    previewBtn.textContent = previewActive ? 'Hide preview' : 'Preview matches';
    if (previewActive) showPreview(); else { hidePreview(); setStatus(''); }
  }

  // ---------- auto-learn ----------
  function refreshLearnUI(stat) {
    var pending = (stat && typeof stat.pending === 'number') ? stat.pending : 0;
    learnCount.textContent = pending + ' pending';
    learnSave.disabled = pending === 0;
    if (stat && typeof stat.enabled === 'boolean') learnToggle.checked = stat.enabled;
  }

  function askContentLearnStatus() {
    withActiveTab(function (tab) {
      try {
        chrome.tabs.sendMessage(tab.id, { action: 'auto_learn_status' }, function (resp) {
          if (chrome.runtime.lastError || !resp) {
            // Page has no content script (chrome://, store pages, etc.)
            refreshLearnUI({ pending: 0 });
            return;
          }
          refreshLearnUI(resp);
        });
      } catch (e) { refreshLearnUI({ pending: 0 }); }
    });
  }

  learnToggle.addEventListener('change', function () {
    var v = learnToggle.checked;
    chrome.storage.local.set({ autoLearnEnabled: v }, function () {
      withActiveTab(function (tab) {
        try {
          chrome.tabs.sendMessage(tab.id, { action: 'auto_learn_set_enabled', value: v }, function (resp) {
            if (!chrome.runtime.lastError && resp) refreshLearnUI(resp);
          });
        } catch (e) {}
      });
      setStatus(v ? 'Auto-Learn ON' : 'Auto-Learn OFF');
    });
  });

  learnSave.addEventListener('click', function () {
    withActiveTab(function (tab) {
      try {
        chrome.tabs.sendMessage(tab.id, { action: 'auto_learn_flush' }, function (resp) {
          if (chrome.runtime.lastError || !resp) { setStatus('Nothing to save'); return; }
          var n = resp.saved || 0;
          var stats = resp.stats || {};
          var cat = stats.category ? stats.category : 'Uncategorized';
          setStatus(n + ' rule' + (n === 1 ? '' : 's') + ' saved → ' + cat, true);
          refreshLearnUI({ pending: 0 });
          loadProfiles();
        });
      } catch (e) { setStatus('Save failed'); }
    });
  });

  // Listen for auto-flushes from submit events while popup is open.
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.action === 'auto_learn_flushed') {
      refreshLearnUI({ pending: 0 });
      if (msg.count) {
        var cat = msg.stats && msg.stats.category ? msg.stats.category : 'Uncategorized';
        setStatus(msg.count + ' learned → ' + cat, true);
        loadProfiles();
      }
    }
  });

  // ---------- profile + storage listeners ----------
  sel.addEventListener('change', function () {
    var v = sel.value;
    chrome.storage.local.set({ activeCategory: v }, function () {
      var label = v === 'all' ? 'All profiles' : (v === '' ? '(Uncategorized)' : v);
      setStatus('Switched to: ' + label);
      if (previewActive) showPreview();
    });
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[FIELDS_KEY] || changes[CATS_KEY] || changes[ACTIVE_CAT_KEY]) loadProfiles();
    if (changes[LEARN_KEY]) learnToggle.checked = !!changes[LEARN_KEY].newValue;
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

  // initial state
  chrome.storage.local.get([LEARN_KEY], function (data) {
    learnToggle.checked = data[LEARN_KEY] !== false; // default ON
  });
  loadProfiles();
  askContentLearnStatus();
})();
