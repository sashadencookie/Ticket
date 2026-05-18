// Custom global hotkey listener for NFilL Automator.
// Reads 'customHotkey' + 'fieldProfiles' + 'activeCategory' from chrome.storage.local
// and autofills matching inputs on the current page.
(function () {
  'use strict';

  var hotkey = null;
  var fields = [];
  var activeCategory = 'all';

  function loadAll(cb) {
    if (!(chrome && chrome.storage && chrome.storage.local)) { cb && cb(); return; }
    chrome.storage.local.get(['customHotkey', 'fieldProfiles', 'activeCategory'], function (data) {
      hotkey = data.customHotkey || null;
      fields = Array.isArray(data.fieldProfiles) ? data.fieldProfiles : [];
      activeCategory = data.activeCategory || 'all';
      cb && cb();
    });
  }

  function matchesHotkey(e, hk) {
    if (!hk || !hk.key) return false;
    if (!!hk.ctrl !== !!(e.ctrlKey || e.metaKey)) return false;
    if (!!hk.alt !== !!e.altKey) return false;
    if (!!hk.shift !== !!e.shiftKey) return false;
    return e.key.toLowerCase() === String(hk.key).toLowerCase();
  }

  function siteMatches(pattern, host) {
    if (!pattern) return true;
    pattern = pattern.trim();
    if (!pattern) return true;
    // wildcard "*.example.com" or "example.com"
    if (pattern.indexOf('*.') === 0) {
      var suffix = pattern.slice(2);
      return host === suffix || host.endsWith('.' + suffix);
    }
    return host === pattern || host.endsWith('.' + pattern);
  }

  function findElement(field) {
    var name = (field.name || '').trim();
    if (!name) return null;
    var mode = field.mode || 'exact';
    var selector;
    if (mode === 'css') {
      try { return document.querySelector(name); } catch (e) { return null; }
    }
    if (mode === 'exact') {
      selector = '[name="' + cssEscape(name) + '"], #' + cssEscape(name);
      try { return document.querySelector(selector); } catch (e) { return null; }
    }
    if (mode === 'contains') {
      var inputs = document.querySelectorAll('input, textarea, select');
      for (var i = 0; i < inputs.length; i++) {
        var n = inputs[i].name || inputs[i].id || '';
        if (n.toLowerCase().indexOf(name.toLowerCase()) !== -1) return inputs[i];
      }
      return null;
    }
    if (mode === 'regex') {
      var re;
      try { re = new RegExp(name); } catch (e) { return null; }
      var els = document.querySelectorAll('input, textarea, select');
      for (var j = 0; j < els.length; j++) {
        if (re.test(els[j].name || '') || re.test(els[j].id || '')) return els[j];
      }
      return null;
    }
    return null;
  }

  function cssEscape(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function fillElement(el, value) {
    if (!el) return;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'select') {
      el.value = value;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = String(value).toLowerCase() === 'true' || value === '1' || value === 'on';
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function runAutofill() {
    var host = location.hostname;
    var count = 0;
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      // category filter (matches the options-page semantics)
      if (activeCategory !== 'all') {
        if (activeCategory === '') {
          if (f.category && f.category !== '') continue;
        } else if ((f.category || '') !== activeCategory) {
          continue;
        }
      }
      if (!siteMatches(f.site, host)) continue;
      var el = findElement(f);
      if (el) { fillElement(el, f.value || ''); count++; }
    }
    return count;
  }

  function onKeydown(e) {
    if (!hotkey) return;
    if (!matchesHotkey(e, hotkey)) return;
    // Don't trigger when the user is typing in an editable field and the key is a plain char
    var target = e.target;
    var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    var isEditing = (tag === 'input' || tag === 'textarea' || (target && target.isContentEditable));
    // We still allow modifier combos in editable fields (Ctrl/Alt/Shift make it a shortcut).
    if (isEditing && !hotkey.ctrl && !hotkey.alt) return;
    e.preventDefault();
    e.stopPropagation();
    runAutofill();
  }

  // Re-load when storage changes (so options-page edits take effect immediately)
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.customHotkey || changes.fieldProfiles || changes.activeCategory) {
        loadAll();
      }
    });
  }

  loadAll(function () {
    window.addEventListener('keydown', onKeydown, true);
  });
})();
