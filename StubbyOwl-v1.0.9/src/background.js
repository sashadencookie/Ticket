/**
 * Stubby Owl — Background Service Worker v1.0.1
 * Manages monitoring state, alarms for auto-refresh (fixed 14.7s), logging, and task completion.
 */

const ALARM_NAME = 'tf-auto-refresh';
const REFRESH_INTERVAL_MIN = 14.7 / 60; // 14.7 seconds in minutes (~0.245 min)
const MAX_LOG_ENTRIES = 500;

// Initialize state on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isMonitoring: false,
    taskCompleted: false,
    monitoringStartTime: null,
    monitoringEndTime: null,
    logs: [],
    settings: {
      eventUrl: '',
      quantity: 1,
      minPrice: 0,
      maxPrice: 0
    },
    proxyList: [],
    proxyConnected: false,
    proxyActiveIndex: -1,
    proxyRefreshCount: 0,
    proxyRotateFailCount: 0,
    proxyConflict: false // Track if another extension is controlling proxy
  });
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'startMonitoring':
      handleStartMonitoring(message.settings);
      break;

    case 'stopMonitoring':
      handleStopMonitoring();
      break;

    case 'settingsUpdated':
      addLog('info', 'Settings updated by user');
      break;

    case 'taskCompleted':
      handleTaskCompleted(message.detail, sender);
      break;

    case 'stopRefreshOnly':
      // Stop the refresh alarm but keep monitoring state active
      chrome.alarms.clear(ALARM_NAME);
      addLog('action', 'Auto-refresh alarm cleared (areas detected, automation in progress)');
      break;

    case 'addLog':
      addLog(message.level || 'info', message.message || '');
      break;

    case 'notAvailable':
      handleNotAvailable(message.detail, sender);
      break;

    // === Proxy actions ===
    case 'proxyDisconnect':
      handleProxyDisconnect().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ error: err.message || 'Unknown error' });
      });
      return true; // Keep message channel open for async response

    case 'proxyRotationTick':
      handleProxyRotationTick().then(() => {
        sendResponse({ success: true });
      }).catch(err => {
        sendResponse({ error: err.message || 'Unknown error' });
      });
      return true; // Keep message channel open for async response

    case 'proxyRotateAndRefresh':
      handleProxyRotateAndRefresh(message.reason || 'unknown').then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ error: err.message || 'Unknown error' });
      });
      return true; // Keep message channel open for async response

    case 'checkProxyControl':
      checkProxyLevelOfControl().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ error: err.message || 'Unknown error' });
      });
      return true;
  }
});

// =============================================
// PROXY MANAGEMENT — Multi-Proxy Rotation
// =============================================
let activeProxyConfig = null; // Currently active proxy config (for auth handler)
const USES_PER_PROXY = 2;     // Each proxy is used for 2 refreshes before rotating

/**
 * Check if this extension is in control of the proxy settings.
 * Returns { inControl: boolean, levelOfControl: string, details: string }
 */
async function checkProxyLevelOfControl() {
  return new Promise((resolve) => {
    chrome.proxy.settings.get({ incognito: false }, (config) => {
      const level = config.levelOfControl;
      let inControl = false;
      let details = '';

      switch (level) {
        case 'controlled_by_this_extension':
          inControl = true;
          details = 'Stubby Owl is controlling the proxy settings.';
          break;
        case 'controllable_by_this_extension':
          inControl = true; // No one is controlling, we can take over
          details = 'Proxy settings are available for Stubby Owl to control.';
          break;
        case 'controlled_by_other_extensions':
          inControl = false;
          details = 'Another extension is controlling the proxy settings. Please disable other proxy/VPN extensions to use Stubby Owl\'s proxy.';
          break;
        case 'not_controllable':
          inControl = false;
          details = 'Proxy settings are locked by a system policy and cannot be changed by any extension.';
          break;
        default:
          inControl = false;
          details = 'Unknown proxy control state: ' + level;
      }

      chrome.storage.local.set({ proxyConflict: !inControl });

      resolve({ inControl, levelOfControl: level, details });
    });
  });
}

/**
 * Connect a specific proxy from the list by index.
 */
async function connectProxyByIndex(index) {
  const data = await chrome.storage.local.get(['proxyList']);
  const list = data.proxyList || [];

  if (list.length === 0) {
    addLog('warn', 'No proxies in list, skipping proxy connection');
    return { success: false, reason: 'empty' };
  }

  // Wrap around if index exceeds list length
  const safeIndex = index % list.length;
  const config = list[safeIndex];

  if (!config || !config.host || !config.port) {
    throw new Error('Invalid proxy at index ' + safeIndex);
  }

  activeProxyConfig = config;

  const schemeMap = { 'http': 'http', 'https': 'https', 'socks4': 'socks4', 'socks5': 'socks5' };
  const scheme = schemeMap[config.protocol] || 'http';

  const proxySettings = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: scheme,
        host: config.host,
        port: config.port
      },
      bypassList: ['localhost', '127.0.0.1', '<local>']
    }
  };

  await chrome.proxy.settings.set({ value: proxySettings, scope: 'regular' });

  // Verify we actually have control after setting
  const controlCheck = await checkProxyLevelOfControl();
  if (!controlCheck.inControl) {
    addLog('warn', 'Proxy conflict detected: ' + controlCheck.details);
    // Still proceed but warn the user
  }

  await chrome.storage.local.set({
    proxyConnected: true,
    proxyActiveIndex: safeIndex,
    proxyRefreshCount: 0
  });

  // Update badge to show which proxy is active
  chrome.action.setBadgeText({ text: '#' + (safeIndex + 1) });
  chrome.action.setBadgeBackgroundColor({ color: '#16A34A' });
  chrome.action.setBadgeTextColor({ color: '#FFFFFF' });

  addLog('info', 'Proxy #' + (safeIndex + 1) + ' connected: ' + config.host + ':' + config.port + ' (' + scheme + ')');
  console.log('[StubbyOwl BG] Proxy #' + (safeIndex + 1) + ' connected:', config.host + ':' + config.port);

  return { success: true, index: safeIndex };
}

/**
 * Disconnect the current proxy.
 */
async function handleProxyDisconnect() {
  activeProxyConfig = null;

  await chrome.proxy.settings.clear({ scope: 'regular' });
  await chrome.storage.local.set({
    proxyConnected: false,
    proxyActiveIndex: -1,
    proxyRefreshCount: 0,
    proxyConflict: false
  });

  chrome.action.setBadgeText({ text: '' });

  addLog('info', 'Proxy disconnected');
  console.log('[StubbyOwl BG] Proxy disconnected');

  return { success: true };
}

/**
 * Called after each page refresh to track usage and rotate proxies.
 * Each proxy is used for USES_PER_PROXY refreshes, then switches to the next.
 */
async function handleProxyRotationTick() {
  const data = await chrome.storage.local.get(['proxyList', 'proxyActiveIndex', 'proxyRefreshCount', 'proxyConnected']);
  const list = data.proxyList || [];

  // A successful page load means the current proxy is working — reset fail counter
  await chrome.storage.local.set({ proxyRotateFailCount: 0 });

  if (list.length === 0 || !data.proxyConnected) return;

  let count = (data.proxyRefreshCount || 0) + 1;
  const currentIndex = data.proxyActiveIndex ?? 0;

  if (count >= USES_PER_PROXY) {
    // Rotate to next proxy
    const nextIndex = (currentIndex + 1) % list.length;
    addLog('action', 'Proxy rotation: #' + (currentIndex + 1) + ' used ' + USES_PER_PROXY + ' times, switching to #' + (nextIndex + 1));
    await connectProxyByIndex(nextIndex);
  } else {
    // Increment counter
    await chrome.storage.local.set({ proxyRefreshCount: count });
    addLog('info', 'Proxy #' + (currentIndex + 1) + ' refresh ' + count + '/' + USES_PER_PROXY);
  }
}

/**
 * Handle proxy error: rotate to the next proxy immediately.
 * Called when the page shows "This site can't be reached", HTTP 407, or similar proxy errors.
 * If all proxies have been tried and all fail, stop monitoring and notify user.
 */
async function handleProxyRotateAndRefresh(reason) {
  const data = await chrome.storage.local.get(['proxyList', 'proxyActiveIndex', 'proxyConnected', 'proxyRotateFailCount']);
  const list = data.proxyList || [];

  if (list.length === 0 || !data.proxyConnected) {
    addLog('warn', 'No proxies configured or proxy not connected. Cannot rotate.');
    return { success: false, allFailed: true };
  }

  const currentIndex = data.proxyActiveIndex ?? 0;
  const failCount = (data.proxyRotateFailCount || 0) + 1;

  addLog('warn', 'Proxy #' + (currentIndex + 1) + ' failed (' + reason + '). Fail count: ' + failCount + '/' + list.length);

  // If we've cycled through all proxies and all failed, stop monitoring
  if (failCount >= list.length) {
    addLog('error', 'All ' + list.length + ' proxies failed. Stopping monitoring.');

    // Reset fail counter
    await chrome.storage.local.set({ proxyRotateFailCount: 0 });

    // Stop monitoring (but keep proxy connected per new behavior)
    chrome.storage.local.set({
      isMonitoring: false,
      taskCompleted: false,
      monitoringEndTime: Date.now()
    });
    chrome.alarms.clear(ALARM_NAME);

    // NOTE: Proxy stays connected — do NOT disconnect here

    // Show Chrome notification
    try {
      chrome.notifications.create('tf-all-proxies-failed', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Stubby Owl \u2014 All Proxies Failed',
        message: 'All proxies returned errors. Monitoring has been stopped. Proxy remains connected.',
        priority: 2,
        requireInteraction: true
      });
    } catch (e) {}

    // Play NotAvailable sound on any eticketing tab
    try {
      const tabs = await chrome.tabs.query({ url: '*://www.eticketing.co.uk/celtic/*' });
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { action: 'playNotAvailableSound' }).catch(() => {});
      }
    } catch (e) {}

    return { success: false, allFailed: true };
  }

  // Rotate to the next proxy
  const nextIndex = (currentIndex + 1) % list.length;
  addLog('action', 'Rotating proxy: #' + (currentIndex + 1) + ' → #' + (nextIndex + 1) + ' (' + list[nextIndex].host + ':' + list[nextIndex].port + ')');

  // Save updated fail count
  await chrome.storage.local.set({ proxyRotateFailCount: failCount });

  // Connect the next proxy
  await connectProxyByIndex(nextIndex);

  return { success: true, newIndex: nextIndex, allFailed: false };
}

// Handle proxy authentication requests
// Manifest V3 requires 'asyncBlocking' — the listener returns a Promise.
chrome.webRequest.onAuthRequired.addListener(
  (details, callbackFn) => {
    if (!details.isProxy) {
      if (callbackFn) { callbackFn({}); return; }
      return {};
    }

    // First try in-memory config
    if (activeProxyConfig && activeProxyConfig.username && activeProxyConfig.password) {
      console.log('[StubbyOwl BG] Providing proxy auth for', details.challenger?.host || 'unknown');
      const response = {
        authCredentials: {
          username: String(activeProxyConfig.username),
          password: String(activeProxyConfig.password)
        }
      };
      if (callbackFn) { callbackFn(response); return; }
      return response;
    }

    // Fallback: read from storage (async)
    console.warn('[StubbyOwl BG] No in-memory proxy config, reading from storage...');
    chrome.storage.local.get(['proxyList', 'proxyActiveIndex', 'proxyConnected'], (data) => {
      if (data.proxyConnected && data.proxyList && data.proxyList.length > 0) {
        const idx = data.proxyActiveIndex ?? 0;
        const config = data.proxyList[idx];
        if (config && config.username && config.password) {
          activeProxyConfig = config; // Cache for next time
          console.log('[StubbyOwl BG] Re-loaded proxy config from storage:', config.host);
          const response = {
            authCredentials: {
              username: String(config.username),
              password: String(config.password)
            }
          };
          if (callbackFn) { callbackFn(response); return; }
        }
      }
      // No valid credentials found
      if (callbackFn) { callbackFn({ cancel: true }); }
    });

    // Return true to indicate async response when no callbackFn
    if (!callbackFn) return { cancel: true };
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking']
);

// Also listen for auth errors and retry with stored credentials
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.error === 'net::ERR_PROXY_AUTH_UNSUPPORTED' ||
        details.error === 'net::ERR_PROXY_AUTH_REQUESTED') {
      console.warn('[StubbyOwl BG] Proxy auth error:', details.error, '- re-reading config from storage');
      // Re-read proxy config from storage to ensure activeProxyConfig is populated
      chrome.storage.local.get(['proxyList', 'proxyActiveIndex', 'proxyConnected'], (data) => {
        if (data.proxyConnected && data.proxyList && data.proxyList.length > 0) {
          const idx = data.proxyActiveIndex ?? 0;
          const config = data.proxyList[idx];
          if (config) {
            activeProxyConfig = config;
            console.log('[StubbyOwl BG] Re-loaded proxy config from storage:', config.host);
          }
        }
      });
    }
  },
  { urls: ['<all_urls>'] }
);

// =============================================
// PROXY CONFLICT DETECTION — onChange listener
// =============================================
// Detect when another extension or policy takes over the proxy settings
chrome.proxy.settings.onChange.addListener((details) => {
  const level = details.levelOfControl;

  if (level === 'controlled_by_other_extensions') {
    addLog('warn', 'Proxy conflict: Another extension has taken control of proxy settings.');
    chrome.storage.local.set({ proxyConflict: true });

    // Show Chrome notification
    try {
      chrome.notifications.create('tf-proxy-conflict', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Stubby Owl \u2014 Proxy Conflict',
        message: 'Another extension is overriding Stubby Owl\'s proxy settings. Please disable other proxy/VPN extensions.',
        priority: 2,
        requireInteraction: true
      });
    } catch (e) {}
  } else if (level === 'not_controllable') {
    addLog('warn', 'Proxy settings are locked by a system policy.');
    chrome.storage.local.set({ proxyConflict: true });
  } else if (level === 'controlled_by_this_extension') {
    // We regained control
    chrome.storage.local.set({ proxyConflict: false });
    addLog('info', 'Stubby Owl has regained control of proxy settings.');
  } else if (level === 'controllable_by_this_extension') {
    chrome.storage.local.set({ proxyConflict: false });
  }
});

// =============================================
// RESTORE PROXY ON BROWSER STARTUP
// =============================================
// Restore proxy state when the browser starts (persists across sessions)
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['proxyList', 'proxyConnected', 'proxyActiveIndex'], (data) => {
    if (data.proxyConnected && data.proxyList && data.proxyList.length > 0) {
      const idx = data.proxyActiveIndex ?? 0;
      connectProxyByIndex(idx).catch(err => {
        console.error('[StubbyOwl BG] Failed to restore proxy on startup:', err);
      });
    }
  });
});

// =============================================
// DISCONNECT PROXY ONLY WHEN BROWSER CLOSES
// =============================================
// When the service worker is about to be suspended (browser closing),
// we mark the proxy as needing disconnect. On next startup, if the browser
// was fully closed (not just suspended), the proxy state will be cleared.
// 
// Note: In Manifest V3, there's no reliable "browser close" event.
// Instead, we use chrome.runtime.onSuspend to detect when the service worker
// is being terminated. We disconnect the proxy here.
chrome.runtime.onSuspend.addListener(() => {
  console.log('[StubbyOwl BG] Service worker suspending — disconnecting proxy');
  // Clear proxy settings synchronously (best effort)
  chrome.proxy.settings.clear({ scope: 'regular' });
  chrome.storage.local.set({
    proxyConnected: false,
    proxyActiveIndex: -1,
    proxyRefreshCount: 0
  });
  chrome.action.setBadgeText({ text: '' });
});

// =============================================
// START MONITORING
// =============================================
async function handleStartMonitoring(settings) {
  const startTime = Date.now();

  chrome.storage.local.set({
    isMonitoring: true,
    taskCompleted: false,
    monitoringStartTime: startTime,
    monitoringEndTime: null,
    settings: settings || {}
  });

  addLog('info', 'Monitoring started');
  if (settings && settings.eventUrl) {
    addLog('info', 'Target URL: ' + settings.eventUrl);
  }
  addLog('info', 'Quantity: ' + (settings?.quantity || 1) +
    ', Min Price: ' + (settings?.minPrice || 0) +
    ', Max Price: ' + (settings?.maxPrice || 0));

  // Get the current active tab — all navigation will happen on this tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = activeTab?.id;

  if (!tabId) {
    addLog('error', 'No active tab found. Cannot start monitoring.');
    chrome.storage.local.set({ isMonitoring: false, monitoringEndTime: Date.now() });
    return;
  }

  // Step 1: Connect proxy first (if configured)
  const data = await chrome.storage.local.get(['proxyList', 'proxyConnected', 'proxyActiveIndex']);
  const list = data.proxyList || [];

  if (list.length > 0) {
    // Reset rotation: always start from proxy #1 when re-monitoring
    await chrome.storage.local.set({
      proxyRefreshCount: 0,
      proxyRotateFailCount: 0
    });

    // Check if a proxy is already connected from a previous session
    if (data.proxyConnected && data.proxyActiveIndex >= 0) {
      addLog('info', 'Proxy #' + (data.proxyActiveIndex + 1) + ' is already connected. Resetting rotation to start from #1.');
    }

    addLog('info', 'Step 1: Connecting proxy #1 before opening event URL...');

    let proxyConnected = false;

    // Try each proxy in the list until one works
    for (let i = 0; i < list.length; i++) {
      addLog('info', 'Attempting proxy #' + (i + 1) + ' of ' + list.length + ': ' + list[i].host + ':' + list[i].port);

      try {
        await connectProxyByIndex(i);

        // Check for proxy conflict with other extensions
        const controlCheck = await checkProxyLevelOfControl();
        if (!controlCheck.inControl) {
          addLog('error', 'Proxy conflict: ' + controlCheck.details);
          addLog('warn', 'Please disable other proxy/VPN extensions and try again.');

          // Show notification about the conflict
          try {
            chrome.notifications.create('tf-proxy-conflict-start', {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'Stubby Owl \u2014 Proxy Conflict',
              message: controlCheck.details,
              priority: 2,
              requireInteraction: true
            });
          } catch (e) {}

          // Stop monitoring since we can't control the proxy
          chrome.storage.local.set({
            isMonitoring: false,
            taskCompleted: false,
            monitoringEndTime: Date.now()
          });
          chrome.alarms.clear(ALARM_NAME);

          // Play NotAvailable sound
          try {
            chrome.tabs.sendMessage(tabId, { action: 'playNotAvailableSound' }).catch(() => {});
          } catch (e) {}

          return; // Abort monitoring
        }

        // Step 2: Open google.com on the SAME TAB to test the connection
        addLog('info', 'Step 2: Testing proxy connection via google.com (same tab)...');

        const testResult = await testProxyConnection(tabId);

        if (testResult.success) {
          addLog('success', 'Proxy #' + (i + 1) + ' connection verified via google.com');
          proxyConnected = true;
          break; // Proxy works, proceed
        } else {
          addLog('warn', 'Proxy #' + (i + 1) + ' failed connection test: ' + testResult.reason);
          // Don't disconnect — try the next proxy by overwriting the settings
        }
      } catch (err) {
        addLog('warn', 'Proxy #' + (i + 1) + ' connection error: ' + (err.message || 'Unknown'));
      }
    }

    if (!proxyConnected) {
      // All proxies failed — stop monitoring and notify user
      addLog('error', 'All ' + list.length + ' proxies failed connection test. Stopping monitoring.');

      chrome.storage.local.set({
        isMonitoring: false,
        taskCompleted: false,
        monitoringEndTime: Date.now()
      });

      chrome.alarms.clear(ALARM_NAME);

      // NOTE: Proxy stays connected (last attempted proxy) — do NOT disconnect

      // Show Chrome notification
      try {
        chrome.notifications.create('tf-proxy-failed', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Stubby Owl \u2014 All Proxies Failed',
          message: 'Unable to connect to any proxy. Monitoring has been stopped. Please check your proxy settings.',
          priority: 2,
          requireInteraction: true
        });
      } catch (e) {}

      // Play the NotAvailable sound on the active tab
      try {
        chrome.tabs.sendMessage(tabId, { action: 'playNotAvailableSound' }).catch(() => {});
      } catch (e) {}

      console.log('[StubbyOwl BG] All proxies failed. Monitoring stopped.');
      return; // Do NOT open the event URL
    }
  } else {
    addLog('info', 'No proxies configured, running without proxy');
  }

  // Step 3: Proxy confirmed (or no proxy needed) — navigate same tab to event URL
  addLog('info', 'Step 3: Proxy ready. Opening event URL on same tab...');

  // Create alarm as backup refresh mechanism (14.7s)
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: REFRESH_INTERVAL_MIN,
    periodInMinutes: 0.5 // 30s backup period
  });

  // Navigate the SAME TAB to the event URL
  if (settings && settings.eventUrl) {
    chrome.tabs.update(tabId, { url: settings.eventUrl });
  }

  console.log('[StubbyOwl BG] Monitoring started, event URL opened on same tab');
}

/**
 * Test proxy connection by navigating the given tab to google.com,
 * waiting for it to load successfully, then returning the result.
 * The event URL will be loaded on the same tab afterwards.
 * @param {number} tabId - The tab to navigate for testing
 * Returns { success: true/false, reason: string }
 */
async function testProxyConnection(tabId) {
  return new Promise((resolve) => {
    let timeoutId = null;
    let resolved = false;

    function done(result) {
      if (resolved) return;
      resolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(result);
    }

    // Navigate the same tab to google.com
    chrome.tabs.update(tabId, { url: 'https://www.google.com' }, () => {
      if (chrome.runtime.lastError) {
        done({ success: false, reason: 'Failed to navigate tab: ' + chrome.runtime.lastError.message });
        return;
      }
      addLog('info', 'Navigating to google.com on current tab (id: ' + tabId + ')');
    });

    // Listen for tab completion
    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;

      if (changeInfo.status === 'complete') {
        // Check if the page loaded successfully (not an error page)
        chrome.tabs.get(tabId, (updatedTab) => {
          if (chrome.runtime.lastError) {
            done({ success: false, reason: 'Tab error: ' + chrome.runtime.lastError.message });
            return;
          }
          if (updatedTab && updatedTab.url && updatedTab.url.includes('google.com')) {
            addLog('success', 'google.com loaded successfully via proxy');
            done({ success: true, reason: 'OK' });
          } else if (updatedTab && updatedTab.url && (updatedTab.url.includes('chrome-error') || updatedTab.url.includes('about:blank'))) {
            done({ success: false, reason: 'Page loaded with error (chrome-error)' });
          } else {
            // Could be a redirect or different page, still consider it a success
            done({ success: true, reason: 'Page loaded (redirected)' });
          }
        });
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    // Timeout after 15 seconds
    timeoutId = setTimeout(() => {
      done({ success: false, reason: 'Connection test timed out (15s)' });
    }, 15000);
  });
}

// =============================================
// STOP MONITORING
// =============================================
// NOTE: Proxy stays connected when monitoring stops.
// Proxy only disconnects when the browser is closed (onSuspend).
async function handleStopMonitoring() {
  const endTime = Date.now();

  chrome.storage.local.set({
    isMonitoring: false,
    taskCompleted: false,
    monitoringEndTime: endTime
  });

  chrome.alarms.clear(ALARM_NAME);

  // DO NOT disconnect proxy — it stays connected until browser closes
  addLog('info', 'Monitoring stopped by user. Proxy remains connected.');
  console.log('[StubbyOwl BG] Monitoring stopped. Proxy remains connected.');
}

// =============================================
// TASK COMPLETED
// =============================================
function handleTaskCompleted(detail, sender) {
  console.log('[StubbyOwl BG] Task completed!', detail);

  const endTime = Date.now();

  // Stop monitoring and mark task as completed
  chrome.storage.local.set({
    isMonitoring: false,
    taskCompleted: true,
    monitoringEndTime: endTime
  });

  // Stop the alarm
  chrome.alarms.clear(ALARM_NAME);

  // DO NOT disconnect proxy — it stays connected until browser closes

  addLog('success', 'Task completed! Tickets added to basket.');

  // Calculate and log duration
  chrome.storage.local.get(['monitoringStartTime'], (data) => {
    if (data.monitoringStartTime) {
      const elapsed = endTime - data.monitoringStartTime;
      const totalSec = Math.floor(elapsed / 1000);
      const hrs = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      const formatted = String(hrs).padStart(2, '0') + ':' +
                        String(mins).padStart(2, '0') + ':' +
                        String(secs).padStart(2, '0');
      addLog('success', 'Total monitoring duration: ' + formatted);
    }
  });

  // Send notification sound command to the tab
  if (sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, { action: 'playSound' }).catch(() => {});
  }

  // Show a Chrome notification as backup
  try {
    chrome.notifications.create('tf-task-completed', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Stubby Owl — Task Completed!',
      message: 'Your tickets have been added to the basket. Monitoring has stopped. Proxy remains connected.',
      priority: 2,
      requireInteraction: true
    });
  } catch (e) {}
}

// =============================================
// NOT AVAILABLE HANDLER
// =============================================
function handleNotAvailable(detail, sender) {
  console.log('[StubbyOwl BG] Event not available:', detail);

  const endTime = Date.now();

  // Stop monitoring
  chrome.storage.local.set({
    isMonitoring: false,
    taskCompleted: false,
    monitoringEndTime: endTime
  });

  // Stop the alarm
  chrome.alarms.clear(ALARM_NAME);

  // DO NOT disconnect proxy — it stays connected until browser closes

  addLog('warn', 'Event not available: ' + (detail?.message || 'Unknown reason'));
  addLog('info', 'Monitoring stopped automatically. Proxy remains connected.');

  // Send notification sound command to the tab
  if (sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, { action: 'playNotAvailableSound' }).catch(() => {});
  }

  // Show a Chrome notification
  try {
    chrome.notifications.create('tf-not-available', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Stubby Owl — Event Not Available',
      message: detail?.message || 'This event is not yet available to you. Monitoring has stopped.',
      priority: 2,
      requireInteraction: true
    });
  } catch (e) {}
}

// =============================================
// AUTO-STOP ON ALL ETICKETING TABS CLOSED
// =============================================
// NOTE: Only stops monitoring, does NOT disconnect proxy.
// Proxy disconnects only when browser closes (onSuspend).
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // Check if the closed tab was the monitored eticketing tab
  chrome.storage.local.get(['isMonitoring', 'settings'], (data) => {
    if (!data.isMonitoring) return;

    // Check if there are any remaining Celtic eticketing tabs
    chrome.tabs.query({ url: '*://www.eticketing.co.uk/celtic/*' }, (tabs) => {
      if (tabs.length === 0) {
        // No more Celtic eticketing tabs — stop monitoring but keep proxy
        addLog('warn', 'All eticketing tabs closed — auto-stopping monitoring. Proxy remains connected.');
        handleStopMonitoring();
      }
    });
  });
});

// =============================================
// ALARM HANDLER
// =============================================
// Refresh Celtic eticketing tabs when alarm fires
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const data = await chrome.storage.local.get(['isMonitoring']);
  if (!data.isMonitoring) {
    chrome.alarms.clear(ALARM_NAME);
    return;
  }

  // Find Celtic eticketing tabs and refresh them
  try {
    const tabs = await chrome.tabs.query({ url: '*://www.eticketing.co.uk/celtic/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'refreshPage' }).catch(() => {
        chrome.tabs.reload(tab.id).catch(() => {});
      });
    }
  } catch (err) {
    console.error('[StubbyOwl BG] Error refreshing tabs:', err);
    addLog('error', 'Failed to refresh tabs: ' + (err.message || 'Unknown error'));
  }
});

/**
 * Add a log entry to storage.
 * @param {string} level - 'info' | 'action' | 'warn' | 'error' | 'success'
 * @param {string} message - The log message
 */
function addLog(level, message) {
  chrome.storage.local.get(['logs'], (data) => {
    const logs = data.logs || [];
    logs.push({
      timestamp: Date.now(),
      level: level,
      message: message
    });

    // Trim to max entries
    while (logs.length > MAX_LOG_ENTRIES) {
      logs.shift();
    }

    chrome.storage.local.set({ logs });
  });
}
