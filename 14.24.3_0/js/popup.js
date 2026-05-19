// Minimal popup — vendor-only.
(function () {
  'use strict';
  var status = document.getElementById('popup-status');

  function setStatus(msg) {
    status.textContent = msg || '';
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(function () { status.textContent = ''; }, 1500);
  }

  document.getElementById('popup-fill').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) return;
      chrome.tabs.sendMessage(tab.id, { action: 'exe_active_cat' });
      setStatus('Autofilling\u2026');
    });
  });

  document.getElementById('popup-manage').addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL('options.html'));
  });
})();
