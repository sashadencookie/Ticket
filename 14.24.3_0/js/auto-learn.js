// Auto-Learn: capture manual field entries and turn them into autofill rules.
(function () {
  'use strict';

  if (window.__nfillAutoLearnLoaded) return;
  window.__nfillAutoLearnLoaded = true;

  var SETTINGS_KEY = 'autoLearnEnabled';
  var FIELDS_KEY = 'fieldProfiles';
  var ACTIVE_CAT_KEY = 'activeCategory';

  var enabled = true;       // default ON; toggled from popup
  var buffer  = new Map();  // key -> capture object

  // ---------- helpers ----------
  function getSite() {
    try { return location.host || ''; } catch (e) { return ''; }
  }

  function inferType(el) {
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select')   return 'select';
    var t = (el.type || 'text').toLowerCase();
    var allowed = ['text','email','tel','number','password','url','date','checkbox','radio','select','textarea'];
    return allowed.indexOf(t) === -1 ? 'text' : t;
  }

  function readValue(el) {
    var tag = (el.tagName || '').toLowerCase();
    var t = (el.type || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio') return el.checked ? (el.value || 'true') : '';
    if (tag === 'select') return el.value || '';
    return el.value == null ? '' : String(el.value);
  }

  function fieldName(el) {
    // Prefer name → id → autocomplete → aria-label → placeholder
    var n = el.name || el.id || el.getAttribute('autocomplete') || el.getAttribute('aria-label') || el.getAttribute('placeholder');
    return String(n || '').trim();
  }

  function keyFor(el) {
    return (getSite() + '|' + (el.name || '') + '|' + (el.id || '')).toLowerCase();
  }

  function isCaptureCandidate(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false;
    if (el.disabled || el.readOnly) return false;
    var t = (el.type || '').toLowerCase();
    if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset' || t === 'file' || t === 'image') return false;
    // Must have *some* identifier so we can match later
    return !!fieldName(el);
  }

  // ---------- capture ----------
  function capture(el) {
    if (!enabled) return;
    if (!isCaptureCandidate(el)) return;
    var val = readValue(el);
    if (val === '') { buffer.delete(keyFor(el)); return; }

    buffer.set(keyFor(el), {
      type:  inferType(el),
      name:  fieldName(el),
      value: val,
      site:  getSite(),
      // metadata used for diagnostics in the popup, not for matching
      meta: {
        id: el.id || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        placeholder: el.getAttribute('placeholder') || '',
      },
    });
  }

  // ---------- save ----------
  function persist(captures, onDone) {
    if (!captures.length) { onDone && onDone(0); return; }
    chrome.storage.local.get([FIELDS_KEY, ACTIVE_CAT_KEY], function (data) {
      var existing = Array.isArray(data[FIELDS_KEY]) ? data[FIELDS_KEY].slice() : [];
      var activeCat = typeof data[ACTIVE_CAT_KEY] === 'string' ? data[ACTIVE_CAT_KEY] : 'all';
      var category = (activeCat === 'all') ? '' : activeCat;

      function sameRule(a, b) {
        return (a.name || '').toLowerCase() === (b.name || '').toLowerCase()
            && (a.site || '').toLowerCase() === (b.site || '').toLowerCase()
            && (a.category || '') === (b.category || '');
      }

      var added = 0, updated = 0;
      for (var i = 0; i < captures.length; i++) {
        var cap = captures[i];
        var rule = {
          type: cap.type, name: cap.name, value: cap.value,
          site: cap.site, category: category,
        };
        var foundIdx = -1;
        for (var j = 0; j < existing.length; j++) {
          if (sameRule(existing[j], rule)) { foundIdx = j; break; }
        }
        if (foundIdx === -1) { existing.push(rule); added++; }
        else if (existing[foundIdx].value !== rule.value) {
          existing[foundIdx].value = rule.value; updated++;
        }
      }

      var payload = {};
      payload[FIELDS_KEY] = existing;
      chrome.storage.local.set(payload, function () {
        onDone && onDone(added + updated, { added: added, updated: updated, category: category });
      });
    });
  }

  function flush(reason, cb) {
    var captures = Array.from(buffer.values());
    buffer.clear();
    persist(captures, function (n, stats) {
      try {
        chrome.runtime.sendMessage({
          action: 'auto_learn_flushed', count: n, reason: reason, stats: stats,
        });
      } catch (e) {}
      cb && cb(n, stats);
    });
  }

  // ---------- listeners ----------
  function onChange(e) { capture(e.target); }
  function onSubmit() {
    if (!enabled || buffer.size === 0) return;
    flush('submit');
  }

  document.addEventListener('change', onChange, true);
  document.addEventListener('input', onChange, true);
  document.addEventListener('submit', onSubmit, true);

  // ---------- messaging API for popup ----------
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.action) return;
    if (msg.action === 'auto_learn_status') {
      sendResponse({ enabled: enabled, pending: buffer.size });
      return true;
    }
    if (msg.action === 'auto_learn_set_enabled') {
      enabled = !!msg.value;
      sendResponse({ enabled: enabled, pending: buffer.size });
      return true;
    }
    if (msg.action === 'auto_learn_flush') {
      flush('manual', function (n, stats) { sendResponse({ saved: n, stats: stats }); });
      return true; // async
    }
    if (msg.action === 'auto_learn_clear') {
      buffer.clear();
      sendResponse({ pending: 0 });
      return true;
    }
  });

  // Read persisted enabled setting on load.
  chrome.storage.local.get([SETTINGS_KEY], function (data) {
    if (typeof data[SETTINGS_KEY] === 'boolean') enabled = data[SETTINGS_KEY];
  });
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      enabled = !!changes[SETTINGS_KEY].newValue;
    }
  });
})();
