// Auto-Learn: capture manual field entries and turn them into autofill rules.
(function () {
  'use strict';

  if (window.__nfillAutoLearnLoaded) return;
  window.__nfillAutoLearnLoaded = true;

  var SETTINGS_KEY = 'autoLearnEnabled';
  var FIELDS_KEY = 'fieldProfiles';
  var ACTIVE_CAT_KEY = 'activeCategory';

  var enabled = false;      // start OFF until storage confirms
  var buffer  = new Map();

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
    var n = el.name || el.id || el.getAttribute('autocomplete') || el.getAttribute('aria-label') || el.getAttribute('placeholder');
    return String(n || '').trim();
  }

  // Stronger key: include placeholder + tag so unnamed inputs don't collide.
  function keyFor(el) {
    var ph = (el.getAttribute && el.getAttribute('placeholder')) || '';
    var tag = (el.tagName || '').toLowerCase();
    return (getSite() + '|' + tag + '|' + (el.name || '') + '|' + (el.id || '') + '|' + ph).toLowerCase();
  }

  function isCaptureCandidate(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false;
    if (el.disabled || el.readOnly) return false;
    var t = (el.type || '').toLowerCase();
    if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset' || t === 'file' || t === 'image') return false;
    return true;
  }

  function capture(el) {
    if (!enabled || !isCaptureCandidate(el)) return;
    var name = fieldName(el);
    if (!name) return;
    var value = readValue(el);
    if (value === '' || value == null) return;
    buffer.set(keyFor(el), {
      type: inferType(el),
      name: name,
      value: value,
      site: getSite()
    });
  }

  function onInput(e) { capture(e.target); }
  function onChange(e) { capture(e.target); }

  function flush(cb) {
    if (buffer.size === 0) { cb && cb(0); return; }
    var captures = Array.from(buffer.values());
    chrome.storage.local.get([FIELDS_KEY, ACTIVE_CAT_KEY], function (data) {
      var fields = Array.isArray(data[FIELDS_KEY]) ? data[FIELDS_KEY] : [];
      var activeCat = data[ACTIVE_CAT_KEY] || '';
      var added = 0;
      captures.forEach(function (c) {
        var exists = fields.some(function (f) {
          return f && String(f.name || '').toLowerCase() === c.name.toLowerCase()
              && String(f.site || '') === String(c.site || '');
        });
        if (exists) return;
        fields.push({
          type: c.type,
          name: c.name,
          value: c.value,
          site: c.site,
          category: activeCat
        });
        added++;
      });
      var update = {};
      update[FIELDS_KEY] = fields;
      chrome.storage.local.set(update, function () {
        buffer.clear();
        try { chrome.runtime.sendMessage({ action: 'auto_learn_flushed', added: added }); } catch (e) {}
        cb && cb(added);
      });
    });
  }

  // Load settings AFTER listeners attach but only enable after callback.
  chrome.storage.local.get([SETTINGS_KEY], function (data) {
    enabled = data[SETTINGS_KEY] !== false;
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) enabled = changes[SETTINGS_KEY].newValue !== false;
  });

  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);

  // Flush on form submit (captures last-state values).
  document.addEventListener('submit', function () { flush(); }, true);

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.action === 'auto_learn_flush') {
      flush(function (added) { sendResponse({ ok: true, added: added }); });
      return true;
    }
    if (msg.action === 'auto_learn_count') {
      sendResponse({ count: buffer.size });
      return true;
    }
  });
})();
