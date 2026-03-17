/**
 * Bridge content script — runs in the extension's isolated world.
 * Communicates between the MAIN world content scripts and the background service worker.
 *
 * Auto-refresh logic:
 * - Does NOT start auto-refresh automatically on page load.
 * - Waits for celtic.js to signal 'tf-start-refresh' (when 0 results detected under "CHOOSE BY AREA").
 * - Only then starts the 14.7s countdown. When the countdown completes, the page reloads.
 * - If celtic.js signals 'tf-stop-refresh' (areas found), the countdown is cancelled.
 */

(function () {
  'use strict';

  const REFRESH_INTERVAL_MS = 14700; // 14.7 seconds
  let refreshTimer = null;
  let isMonitoring = false;
  let notificationPlayed = false;
  let refreshPaused = false; // Paused when areas are found

  // === Initialize ===
  init();

  function init() {
    // Load current monitoring state and settings
    chrome.storage.local.get(['isMonitoring', 'settings'], (data) => {
      isMonitoring = data.isMonitoring || false;
      relayMonitoringState();
      relaySettings(data.settings);

      if (isMonitoring) {
        // Do NOT start auto-refresh here — wait for celtic.js to signal
        sendLog('info', 'Page loaded: ' + window.location.href);
      }
    });

    // Listen for storage changes (from popup or background)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes.isMonitoring) {
        isMonitoring = changes.isMonitoring.newValue || false;
        relayMonitoringState();

        if (isMonitoring) {
          notificationPlayed = false;
          refreshPaused = false;
          // Do NOT start auto-refresh here — wait for celtic.js to signal
        } else {
          stopAutoRefresh();
        }
      }

      if (changes.settings) {
        relaySettings(changes.settings.newValue);
      }
    });

    // Listen for log events from MAIN world (celtic.js)
    window.addEventListener('tf-log', (e) => {
      const detail = e.detail || {};
      sendLog(detail.level || 'info', detail.message || '');
    });

    // Listen for START-refresh events from MAIN world (0 results detected)
    window.addEventListener('tf-start-refresh', (e) => {
      const reason = e.detail?.reason || 'unknown';
      sendLog('info', 'Starting 14.7s refresh countdown (reason: ' + reason + ')');
      refreshPaused = false;
      startAutoRefresh();
    });

    // Listen for QUICK-refresh events (5s refresh for error pages)
    window.addEventListener('tf-quick-refresh', (e) => {
      const reason = e.detail?.reason || 'unknown';
      const delay = e.detail?.delay || 5000;
      sendLog('warn', 'Quick refresh in ' + (delay / 1000) + 's (reason: ' + reason + ')');
      refreshPaused = false;
      startQuickRefresh(delay);
    });

    // Listen for NOT-AVAILABLE events (stop monitoring + play NotAvailable sound)
    window.addEventListener('tf-not-available', (e) => {
      const message = e.detail?.message || 'Event not yet available';
      sendLog('warn', 'NOT AVAILABLE: ' + message + ' — Stopping monitoring and notifying user');

      // Stop auto-refresh
      stopAutoRefresh();

      // Play the NotAvailable sound
      playNotAvailableSound();

      // Notify background to stop monitoring
      chrome.runtime.sendMessage({
        action: 'notAvailable',
        detail: { message: message, timestamp: Date.now() }
      });
    });

    // Listen for proxy rotation tick events from MAIN world (page loaded = 1 use of proxy)
    window.addEventListener('tf-proxy-tick', () => {
      try {
        chrome.runtime.sendMessage({ action: 'proxyRotationTick' }, () => {});
      } catch (err) {}
    });

    // Listen for PROXY-ERROR events from MAIN world ("This site can't be reached", 407, etc.)
    // Rotate to the next proxy and refresh the page
    window.addEventListener('tf-proxy-error', (e) => {
      const reason = e.detail?.reason || 'unknown';
      sendLog('warn', 'Proxy error detected (' + reason + '). Requesting proxy rotation and refresh...');

      // Tell background.js to rotate to the next proxy
      chrome.runtime.sendMessage({ action: 'proxyRotateAndRefresh', reason: reason }, (response) => {
        if (response && response.allFailed) {
          sendLog('error', 'All proxies have failed. Stopping monitoring.');
          // Background will handle stopping and notification
        } else {
          sendLog('info', 'Proxy rotated. Refreshing page in 3s...');
          // Give the new proxy a moment to settle, then refresh
          setTimeout(() => {
            if (isMonitoring) {
              location.reload();
            }
          }, 3000);
        }
      });
    });

    // Listen for STOP-refresh events from MAIN world (areas detected)
    window.addEventListener('tf-stop-refresh', (e) => {
      const reason = e.detail?.reason || 'unknown';
      sendLog('action', 'Auto-refresh stopped: ' + reason);
      refreshPaused = true;
      stopAutoRefresh();
      // Also clear the background alarm
      try {
        chrome.runtime.sendMessage({ action: 'stopRefreshOnly' });
      } catch (err) {}
    });

    // Listen for task-completed events from MAIN world
    window.addEventListener('tf-task-completed', (e) => {
      if (!isMonitoring) return;

      console.log('[StubbyOwl] Task completed:', e.detail);

      // Stop auto-refresh
      stopAutoRefresh();

      // Play notification sound
      playNotificationSound();

      // Notify background to stop monitoring and show completion
      chrome.runtime.sendMessage({
        action: 'taskCompleted',
        detail: e.detail
      });
    });

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'playSound') {
        playNotificationSound();
      }
      if (message.action === 'playNotAvailableSound') {
        playNotAvailableSound();
      }
      if (message.action === 'refreshPage') {
        if (refreshPaused) {
          sendLog('info', 'Refresh skipped — areas detected, automation in progress');
          return;
        }
        sendLog('info', 'Auto-refresh triggered (backup alarm)');
        location.reload();
      }
    });
  }

  /**
   * Send a log entry to the background service worker for storage.
   */
  function sendLog(level, message) {
    try {
      chrome.runtime.sendMessage({
        action: 'addLog',
        level: level,
        message: message
      });
    } catch (e) {
      // Extension context may be invalidated on page unload
    }
  }

  function relayMonitoringState() {
    window.dispatchEvent(new CustomEvent('tf-monitoring-state', {
      detail: { isMonitoring }
    }));
  }

  function relaySettings(settings) {
    if (!settings) return;
    window.dispatchEvent(new CustomEvent('tf-settings-update', {
      detail: { settings }
    }));
  }

  /**
   * Start the 14.7s countdown. When it completes, reload the page.
   * This is only called when celtic.js detects 0 results.
   */
  function startAutoRefresh() {
    stopAutoRefresh(); // Clear any existing timer
    refreshTimer = setTimeout(() => {
      if (isMonitoring && !refreshPaused) {
        sendLog('info', 'Auto-refreshing page (14.7s countdown completed)');
        // Signal proxy rotation tick before reloading
        try {
          chrome.runtime.sendMessage({ action: 'proxyRotationTick' }, () => {
            location.reload();
          });
        } catch (err) {
          location.reload();
        }
      }
    }, REFRESH_INTERVAL_MS);
    console.log('[StubbyOwl] 14.7s refresh countdown started');
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      console.log('[StubbyOwl] Auto-refresh countdown cancelled');
    }
  }

  /**
   * Start a quick refresh countdown (e.g. 5s for error pages).
   */
  function startQuickRefresh(delay) {
    stopAutoRefresh(); // Clear any existing timer
    refreshTimer = setTimeout(() => {
      if (isMonitoring && !refreshPaused) {
        sendLog('info', 'Quick-refreshing page (' + (delay / 1000) + 's countdown completed)');
        // Signal proxy rotation tick before reloading
        try {
          chrome.runtime.sendMessage({ action: 'proxyRotationTick' }, () => {
            location.reload();
          });
        } catch (err) {
          location.reload();
        }
      }
    }, delay);
    console.log('[StubbyOwl] Quick refresh countdown started: ' + delay + 'ms');
  }

  /**
   * Play the BasketedTicket sound for successful basket confirmation.
   */
  function playNotificationSound() {
    if (notificationPlayed) return;
    notificationPlayed = true;

    sendLog('info', 'Playing basket success sound');

    try {
      const audioUrl = chrome.runtime.getURL('assets/basketed-ticket.mp3');
      const audio = new Audio(audioUrl);
      audio.volume = 1.0;

      let playCount = 0;
      const maxPlays = 3;

      function playOnce() {
        audio.currentTime = 0;
        audio.play().catch(err => {
          console.warn('[StubbyOwl] Could not play basket sound:', err);
          sendLog('error', 'Failed to play basket sound: ' + (err.message || 'Unknown'));
        });
        playCount++;
        if (playCount < maxPlays) {
          setTimeout(playOnce, 2000);
        }
      }

      playOnce();
    } catch (err) {
      console.warn('[StubbyOwl] Basket sound error:', err);
      sendLog('error', 'Basket sound error: ' + (err.message || 'Unknown'));
    }
  }

  /**
   * Play the NotAvailable sound when event is not yet available.
   */
  function playNotAvailableSound() {
    sendLog('info', 'Playing "Not Available" notification sound');

    try {
      const audioUrl = chrome.runtime.getURL('assets/not-available.mp3');
      const audio = new Audio(audioUrl);
      audio.volume = 1.0;

      let playCount = 0;
      const maxPlays = 3;

      function playOnce() {
        audio.currentTime = 0;
        audio.play().catch(err => {
          console.warn('[StubbyOwl] Could not play not-available sound:', err);
          sendLog('error', 'Failed to play not-available sound: ' + (err.message || 'Unknown'));
        });
        playCount++;
        if (playCount < maxPlays) {
          setTimeout(playOnce, 2000);
        }
      }

      playOnce();
    } catch (err) {
      console.warn('[StubbyOwl] Not-available sound error:', err);
      sendLog('error', 'Not-available sound error: ' + (err.message || 'Unknown'));
    }
  }

})();
