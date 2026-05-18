// Hotkeys tab logic for the options page.
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function load(cb) {
    if (!(chrome && chrome.storage && chrome.storage.local)) { cb({}); return; }
    chrome.storage.local.get('customHotkey', function (data) { cb(data.customHotkey || null); });
  }

  function save(hk, cb) {
    if (!(chrome && chrome.storage && chrome.storage.local)) { cb && cb(); return; }
    chrome.storage.local.set({ customHotkey: hk }, function () { cb && cb(); });
  }

  function formatHotkey(hk) {
    if (!hk || !hk.key) return '(not set)';
    var parts = [];
    if (hk.ctrl) parts.push('Ctrl');
    if (hk.alt) parts.push('Alt');
    if (hk.shift) parts.push('Shift');
    parts.push(hk.key.length === 1 ? hk.key.toUpperCase() : hk.key);
    return parts.join(' + ');
  }

  function showNativeBindings() {
    var out = $('native-hotkey-list');
    if (!out || !(chrome.commands && chrome.commands.getAll)) return;
    chrome.commands.getAll(function (cmds) {
      out.textContent = '';
      cmds.forEach(function (c) {
        var row = document.createElement('div');
        row.className = 'native-cmd-row';
        var name = document.createElement('span');
        name.className = 'native-cmd-name';
        name.textContent = c.description || c.name;
        var shortcut = document.createElement('span');
        shortcut.className = 'native-cmd-shortcut';
        shortcut.textContent = c.shortcut || '(not set)';
        row.appendChild(name);
        row.appendChild(shortcut);
        out.appendChild(row);
      });
    });
  }

  function init() {
    var display = $('hotkey-display');
    var recordBtn = $('hotkey-record');
    var clearBtn = $('hotkey-clear');
    var status = $('hotkey-status');
    var openShortcuts = $('hotkey-open-chrome-shortcuts');
    if (!display || !recordBtn) return;

    load(function (hk) { display.textContent = formatHotkey(hk); });
    showNativeBindings();

    var recording = false;
    function captureKey(e) {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      // ignore modifier-only presses
      if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;
      var hk = {
        ctrl: e.ctrlKey || e.metaKey,
        alt: e.altKey,
        shift: e.shiftKey,
        key: e.key,
      };
      save(hk, function () {
        display.textContent = formatHotkey(hk);
        status.textContent = 'Saved.';
        setTimeout(function () { status.textContent = ''; }, 1500);
      });
      recording = false;
      recordBtn.textContent = 'Record';
      window.removeEventListener('keydown', captureKey, true);
    }

    recordBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (recording) {
        recording = false;
        recordBtn.textContent = 'Record';
        window.removeEventListener('keydown', captureKey, true);
        return;
      }
      recording = true;
      recordBtn.textContent = 'Press a key…';
      status.textContent = 'Listening — press your shortcut (Esc to cancel).';
      window.addEventListener('keydown', captureKey, true);
    });

    clearBtn.addEventListener('click', function (e) {
      e.preventDefault();
      save(null, function () {
        display.textContent = '(not set)';
        status.textContent = 'Cleared.';
        setTimeout(function () { status.textContent = ''; }, 1500);
      });
    });

    if (openShortcuts) {
      openShortcuts.addEventListener('click', function (e) {
        e.preventDefault();
        if (chrome && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
        } else {
          window.open('chrome://extensions/shortcuts', '_blank');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
