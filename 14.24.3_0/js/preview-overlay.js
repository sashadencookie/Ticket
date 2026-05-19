// Preview overlay — highlights inputs the autofill engine would match.
(function () {
  'use strict';

  var OVERLAY_ID = '__nfill_preview_overlay__';
  var STYLE_ID   = '__nfill_preview_style__';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '#' + OVERLAY_ID + '{position:fixed;inset:0;pointer-events:none;z-index:2147483646;}' +
      '#' + OVERLAY_ID + ' .nfill-mark{position:absolute;border:2px solid #f59e0b;' +
      'background:rgba(254,243,199,.35);border-radius:3px;box-shadow:0 0 0 1px rgba(245,158,11,.6);}' +
      '#' + OVERLAY_ID + ' .nfill-tag{position:absolute;transform:translate(-1px,-100%);' +
      'background:#f59e0b;color:#1f2937;font:600 10px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;' +
      'padding:2px 5px;border-radius:3px 3px 3px 0;white-space:nowrap;max-width:280px;overflow:hidden;' +
      'text-overflow:ellipsis;}';
    document.documentElement.appendChild(style);
  }

  function clearOverlay() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }

  function siteMatches(siteRule) {
    var s = String(siteRule || '').trim();
    if (!s) return true;
    try {
      return location.host.indexOf(s) !== -1 || location.href.indexOf(s) !== -1;
    } catch (e) { return true; }
  }

  function ruleMatchesEl(rule, el) {
    var needle = String(rule.name || '').trim().toLowerCase();
    if (!needle) return false;
    var hay = [
      el.name, el.id, el.getAttribute && el.getAttribute('placeholder'),
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('autocomplete')
    ].map(function (v) { return String(v || '').toLowerCase(); }).join(' ');
    return hay.indexOf(needle) !== -1;
  }

  function typeMatches(rule, el) {
    var rt = String(rule.type || '').toLowerCase();
    if (!rt || rt === 'text') return true; // text is a soft default
    var tag = (el.tagName || '').toLowerCase();
    var et  = (el.type || '').toLowerCase();
    if (rt === 'textarea') return tag === 'textarea';
    if (rt === 'select')   return tag === 'select';
    if (rt === 'checkbox' || rt === 'radio') return et === rt;
    return et === rt;
  }

  function collectInputs() {
    var nodes = document.querySelectorAll('input, select, textarea');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.disabled) continue;
      if (el.type === 'hidden') continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue; // skip invisible
      out.push({ el: el, rect: rect });
    }
    return out;
  }

  function highlight(rules, activeCategory) {
    clearOverlay();
    ensureStyle();

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    document.documentElement.appendChild(overlay);

    var inputs = collectInputs();
    var matches = 0;

    var applicable = rules.filter(function (r) {
      if (activeCategory && activeCategory !== 'all') {
        if ((r.category || '') !== activeCategory) return false;
      }
      return siteMatches(r.site);
    });

    for (var i = 0; i < inputs.length; i++) {
      var entry = inputs[i];
      var matched = null;
      for (var j = 0; j < applicable.length; j++) {
        var rule = applicable[j];
        if (typeMatches(rule, entry.el) && ruleMatchesEl(rule, entry.el)) {
          matched = rule; break;
        }
      }
      if (!matched) continue;
      matches++;

      var mark = document.createElement('div');
      mark.className = 'nfill-mark';
      mark.style.left   = entry.rect.left + 'px';
      mark.style.top    = entry.rect.top + 'px';
      mark.style.width  = entry.rect.width + 'px';
      mark.style.height = entry.rect.height + 'px';
      overlay.appendChild(mark);

      var tag = document.createElement('div');
      tag.className = 'nfill-tag';
      tag.style.left = entry.rect.left + 'px';
      tag.style.top  = entry.rect.top + 'px';
      tag.textContent = (matched.name || 'field') +
        (matched.value ? ' → ' + String(matched.value).slice(0, 40) : '');
      overlay.appendChild(tag);
    }

    return matches;
  }

  // Message API used by the popup.
  window.__nfillPreview = {
    show: function (rules, activeCategory) { return highlight(rules || [], activeCategory || 'all'); },
    hide: clearOverlay,
  };
})();
