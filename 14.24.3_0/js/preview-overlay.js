// Preview overlay — highlights inputs the autofill engine would match.
(function () {
  'use strict';

  var OVERLAY_ID = '__nfill_preview_overlay__';
  var STYLE_ID   = '__nfill_preview_style__';
  var REFRESH_BOUND = false;
  var LAST_RULES = null;
  var REFRESH_TIMER = null;

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
    LAST_RULES = null;
  }

  // Exact host or proper suffix match (prevents evil-google.com matching google.com).
  function siteMatches(siteRule) {
    var s = String(siteRule || '').trim().toLowerCase();
    if (!s) return true;
    var host = '';
    try { host = String(location.hostname || '').toLowerCase(); } catch (e) { return false; }
    if (host === s) return true;
    if (host.endsWith('.' + s)) return true;
    // Also allow explicit URL substring rules that include a slash or scheme.
    if (s.indexOf('/') !== -1 || s.indexOf(':') !== -1) {
      try { return location.href.toLowerCase().indexOf(s) !== -1; } catch (e) { return false; }
    }
    return false;
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
    if (!rt || rt === 'text') return true;
    var tag = (el.tagName || '').toLowerCase();
    if (rt === 'textarea') return tag === 'textarea';
    if (rt === 'select')   return tag === 'select';
    return (el.type || '').toLowerCase() === rt;
  }

  function findInputs() {
    return Array.prototype.slice.call(document.querySelectorAll('input, select, textarea'));
  }

  function buildOverlay(rules) {
    clearOverlay();
    ensureStyle();
    LAST_RULES = rules;
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    var inputs = findInputs();
    var count = 0;
    inputs.forEach(function (el) {
      var match = null;
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (!siteMatches(r.site)) continue;
        if (!typeMatches(r, el)) continue;
        if (ruleMatchesEl(r, el)) { match = r; break; }
      }
      if (!match) return;
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      var mark = document.createElement('div');
      mark.className = 'nfill-mark';
      mark.style.left = rect.left + 'px';
      mark.style.top = rect.top + 'px';
      mark.style.width = rect.width + 'px';
      mark.style.height = rect.height + 'px';
      var tag = document.createElement('div');
      tag.className = 'nfill-tag';
      tag.style.left = rect.left + 'px';
      tag.style.top = rect.top + 'px';
      tag.textContent = match.name + (match.value ? ': ' + match.value : '');
      overlay.appendChild(mark);
      overlay.appendChild(tag);
      count++;
    });
    document.documentElement.appendChild(overlay);
    bindRefresh();
    return count;
  }

  function scheduleRefresh() {
    if (!LAST_RULES) return;
    if (REFRESH_TIMER) cancelAnimationFrame(REFRESH_TIMER);
    REFRESH_TIMER = requestAnimationFrame(function () {
      if (LAST_RULES) buildOverlay(LAST_RULES);
    });
  }

  function bindRefresh() {
    if (REFRESH_BOUND) return;
    REFRESH_BOUND = true;
    window.addEventListener('scroll', scheduleRefresh, true);
    window.addEventListener('resize', scheduleRefresh, true);
  }

  window.__nfillPreviewBuild = buildOverlay;
  window.__nfillPreviewClear = clearOverlay;
})();
