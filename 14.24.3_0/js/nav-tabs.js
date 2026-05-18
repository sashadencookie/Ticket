// Auto-generated nav/tab wiring for NFilL Automator options page.
// CSP-safe: external script, no inline code, no eval.
(function () {
  'use strict';

  var TAB_KEYS = ['fields', 'advanced', 'proxypool', 'settings', 'sync', 'hotkeys'];

  function setActiveTab(key) {
    if (TAB_KEYS.indexOf(key) === -1) return;
    document.body.id = key;
    var links = document.querySelectorAll('nav ul li a');
    for (var i = 0; i < links.length; i++) {
      links[i].removeAttribute('data-active');
    }
    var active = document.getElementById('nav-' + key);
    if (active) active.setAttribute('data-active', '');
    try {
      if (location.hash.replace('#', '') !== key) location.hash = key;
    } catch (e) {}
  }

  function initNav() {
    for (var i = 0; i < TAB_KEYS.length; i++) {
      (function (key) {
        var el = document.getElementById('nav-' + key);
        if (!el) return;
        el.addEventListener('click', function (e) {
          e.preventDefault();
          setActiveTab(key);
        });
      })(TAB_KEYS[i]);
    }

    // Honor initial hash, otherwise default to whatever body id is already set
    var initial = (location.hash || '').replace('#', '');
    if (TAB_KEYS.indexOf(initial) !== -1) {
      setActiveTab(initial);
    } else if (TAB_KEYS.indexOf(document.body.id) === -1) {
      setActiveTab('fields');
    }
  }

  function initProxyPool() {
    var btn = document.getElementById('button-save-proxies');
    var ta = document.getElementById('content-proxypool');
    var status = document.getElementById('proxypool-status');
    if (!btn || !ta) return;

    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('proxyPool', function (data) {
        if (data && typeof data.proxyPool === 'string') ta.value = data.proxyPool;
      });
    }

    btn.addEventListener('click', function () {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set({ proxyPool: ta.value }, function () {
        if (!status) return;
        status.textContent = 'Proxies saved successfully.';
        status.style.display = 'block';
        status.style.color = 'green';
        setTimeout(function () { status.style.display = 'none'; }, 2500);
      });
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    initNav();
    initProxyPool();
  });
})();
