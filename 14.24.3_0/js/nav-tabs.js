// Tab navigation for NFilL Automator options page.
(function () {
  'use strict';
  var TAB_KEYS = ['fields', 'advanced', 'proxypool', 'settings', 'sync'];

  function setActiveTab(key) {
    if (TAB_KEYS.indexOf(key) === -1) return;
    document.body.id = key;
    var links = document.querySelectorAll('nav ul li a');
    for (var i = 0; i < links.length; i++) links[i].removeAttribute('data-active');
    var active = document.getElementById('nav-' + key);
    if (active) active.setAttribute('data-active', '');
    try { if (location.hash.replace('#', '') !== key) location.hash = key; } catch (e) {}
  }

  function init() {
    for (var i = 0; i < TAB_KEYS.length; i++) {
      (function (key) {
        var el = document.getElementById('nav-' + key);
        if (!el) return;
        el.addEventListener('click', function (e) { e.preventDefault(); setActiveTab(key); });
      })(TAB_KEYS[i]);
    }
    var initial = (location.hash || '').replace('#', '');
    if (TAB_KEYS.indexOf(initial) !== -1) setActiveTab(initial);
    else if (TAB_KEYS.indexOf(document.body.id) === -1) setActiveTab('fields');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
