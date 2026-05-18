// Toolbar popup: quickly switch the active profile (category).
(function () {
  'use strict';

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

  function buildOptions(cats, active) {
    sel.textContent = '';
    var optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = 'All profiles';
    sel.appendChild(optAll);

    if (Array.isArray(cats)) {
      for (var i = 0; i < cats.length; i++) {
        var name = String(cats[i] || '').trim();
        if (!name) continue;
        var o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        sel.appendChild(o);
      }
    }

    var allowed = ['all'];
    if (Array.isArray(cats)) {
      for (var j = 0; j < cats.length; j++) allowed.push(String(cats[j]));
    }
    sel.value = allowed.indexOf(active) === -1 ? 'all' : active;
  }

  function load() {
    if (!(chrome && chrome.storage && chrome.storage.local)) return;
    chrome.storage.local.get([CATS_KEY, ACTIVE_CAT_KEY], function (data) {
      buildOptions(data[CATS_KEY] || [], typeof data[ACTIVE_CAT_KEY] === 'string' ? data[ACTIVE_CAT_KEY] : 'all');
    });
  }

  sel.addEventListener('change', function () {
    var v = sel.value;
    chrome.storage.local.set({ activeCategory: v }, function () {
      setStatus('Switched to: ' + (v === 'all' ? 'All profiles' : v));
    });
  });

  // React to changes made elsewhere (options page, other windows)
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[CATS_KEY] || changes[ACTIVE_CAT_KEY]) load();
  });

  $('popup-fill').addEventListener('click', function () {
    // Trigger the existing "execute active profile" command path.
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'exe_active_cat' }, function () { /* ignore */ });
    }
    // Also try the keyboard-command runtime so legacy listeners fire.
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs && tabs[0] && chrome.tabs.sendMessage) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'exe_active_cat' });
        }
      });
    } catch (e) {}
    setStatus('Autofilling…');
  });

  $('popup-options').addEventListener('click', function () {
    if (chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
    window.close();
  });

  load();
})();
