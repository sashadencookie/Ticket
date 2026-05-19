// Toolbar popup: quickly switch the active profile (category).
(function () {
  'use strict';

  var FIELDS_KEY = 'fieldProfiles';
  var CATS_KEY = 'fieldCategories';
  var ACTIVE_CAT_KEY = 'activeCategory';

  var $ = function (id) { return document.getElementById(id); };
  var sel = $('popup-profile');
  var status = $('popup-status');

  function setStatus(msg) {
    status.textContent = msg || '';
    if (msg) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(function () { status.textContent = ''; }, 1500);
    }
  }

  // Merge categories from the explicit list AND any category names actually used
  // by saved fields, so the popup never appears empty when the user has profiles.
  function collectProfiles(catsList, fields) {
    var set = Object.create(null);
    var order = [];

    function add(name) {
      var n = String(name == null ? '' : name).trim();
      if (!n) return;
      if (set[n]) return;
      set[n] = true;
      order.push(n);
    }

    if (Array.isArray(catsList)) catsList.forEach(add);
    if (Array.isArray(fields)) fields.forEach(function (f) { if (f) add(f.category); });

    return order;
  }

  function buildOptions(profiles, active) {
    sel.textContent = '';

    var optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = 'All profiles';
    sel.appendChild(optAll);

    var optDefault = document.createElement('option');
    optDefault.value = '';
    optDefault.textContent = '(Uncategorized)';
    sel.appendChild(optDefault);

    for (var i = 0; i < profiles.length; i++) {
      var o = document.createElement('option');
      o.value = profiles[i];
      o.textContent = profiles[i];
      sel.appendChild(o);
    }

    var allowed = ['all', ''].concat(profiles);
    sel.value = allowed.indexOf(active) === -1 ? 'all' : active;
  }

  function load() {
    if (!(chrome && chrome.storage && chrome.storage.local)) return;
    chrome.storage.local.get([FIELDS_KEY, CATS_KEY, ACTIVE_CAT_KEY], function (data) {
      var profiles = collectProfiles(data[CATS_KEY] || [], data[FIELDS_KEY] || []);
      var active = typeof data[ACTIVE_CAT_KEY] === 'string' ? data[ACTIVE_CAT_KEY] : 'all';
      buildOptions(profiles, active);
    });
  }

  sel.addEventListener('change', function () {
    var v = sel.value;
    chrome.storage.local.set({ activeCategory: v }, function () {
      var label = v === 'all' ? 'All profiles' : (v === '' ? '(Uncategorized)' : v);
      setStatus('Switched to: ' + label);
    });
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[FIELDS_KEY] || changes[CATS_KEY] || changes[ACTIVE_CAT_KEY]) load();
  });

  $('popup-fill').addEventListener('click', function () {
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'exe_active_cat' }, function () { /* ignore */ });
    }
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs && tabs[0] && chrome.tabs.sendMessage) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'exe_active_cat' });
        }
      });
    } catch (e) {}
    setStatus('Autofilling…');
  });

  // "Manage profiles" — open options.html on the Fields tab (where the
  // category manager lives). Falls back to openOptionsPage if needed.
  $('popup-manage').addEventListener('click', function () {
    var url = chrome.runtime.getURL('options.html#fields');
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url });
    } else if (chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
    window.close();
  });

  load();
})();
