document.addEventListener('DOMContentLoaded', () => {
  // === Element References ===
  const eventUrlEl = document.getElementById('event-url');
  const urlError = document.getElementById('url-error');
  const quantityEl = document.getElementById('quantity');
  const minPriceEl = document.getElementById('min-price');
  const maxPriceEl = document.getElementById('max-price');
  const saveBtn = document.getElementById('save-btn');
  const startBtn = document.getElementById('start-btn');
  const statusBar = document.getElementById('status-bar');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const durationDisplay = document.getElementById('duration-display');
  const durationText = document.getElementById('duration-text');
  const toast = document.getElementById('toast');
  const completionModal = document.getElementById('completion-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalDuration = document.getElementById('modal-duration');

  // Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const logsPanel = document.getElementById('logs-panel');
  const eventPanel = document.getElementById('event-panel');
  const proxyPanel = document.getElementById('proxy-panel');

  // Proxy elements
  const proxyProtocolEl = document.getElementById('proxy-protocol');
  const proxyHostEl = document.getElementById('proxy-host');
  const proxyPortEl = document.getElementById('proxy-port');
  const proxyUserEl = document.getElementById('proxy-user');
  const proxyPassEl = document.getElementById('proxy-pass');
  const proxyAddBtn = document.getElementById('proxy-add-btn');
  const proxyClearBtn = document.getElementById('proxy-clear-btn');
  const proxyListEl = document.getElementById('proxy-list');
  const proxyCountEl = document.getElementById('proxy-count');
  const proxyStatusEl = document.getElementById('proxy-status');
  const proxyStatusDot = document.getElementById('proxy-status-dot');
  const proxyStatusText = document.getElementById('proxy-status-text');
  const proxyConflictWarning = document.getElementById('proxy-conflict-warning');
  const proxyConflictText = document.getElementById('proxy-conflict-text');

  // Logs
  const logsContainer = document.getElementById('logs-container');
  const exportLogsBtn = document.getElementById('export-logs-btn');
  const clearLogsBtn = document.getElementById('clear-logs-btn');

  let savedSettings = null;
  let settingsChanged = false;
  let durationTimer = null;
  let monitoringStartTime = null;

  // =============================================
  // TAB SWITCHING
  // =============================================
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      logsPanel.classList.toggle('hidden', tab !== 'logs');
      eventPanel.classList.toggle('hidden', tab !== 'event');
      proxyPanel.classList.toggle('hidden', tab !== 'proxy');

      // Refresh logs when switching to logs tab
      if (tab === 'logs') {
        loadLogs();
      }

      // Load proxy state when switching to proxy tab
      if (tab === 'proxy') {
        loadProxyState();
      }
    });
  });

  // =============================================
  // INITIALIZATION
  // =============================================
  chrome.storage.local.get(
    ['settings', 'isMonitoring', 'taskCompleted', 'monitoringStartTime', 'monitoringEndTime'],
    (data) => {
      if (data.settings) {
        eventUrlEl.value = data.settings.eventUrl || '';
        quantityEl.value = data.settings.quantity || '1';
        minPriceEl.value = data.settings.minPrice || '';
        maxPriceEl.value = data.settings.maxPrice || '';
        savedSettings = { ...data.settings };
      }
      updateStatus(data.isMonitoring, data.taskCompleted);
      updateStartButton();
      saveBtn.disabled = true;

      // Duration timer
      if (data.isMonitoring && data.monitoringStartTime) {
        monitoringStartTime = data.monitoringStartTime;
        startDurationTimer();
      } else if (data.taskCompleted && data.monitoringStartTime && data.monitoringEndTime) {
        // Show final duration
        const elapsed = data.monitoringEndTime - data.monitoringStartTime;
        durationText.textContent = formatDuration(elapsed);
        durationDisplay.classList.remove('hidden');
      }

      if (data.taskCompleted) {
        showCompletionModal(data.monitoringStartTime, data.monitoringEndTime);
      }
    }
  );

  // =============================================
  // FORM CHANGE TRACKING
  // =============================================
  function onFormChange() {
    settingsChanged = hasUnsavedChanges();
    saveBtn.disabled = !settingsChanged;
    updateStartButton();
  }

  eventUrlEl.addEventListener('input', onFormChange);
  quantityEl.addEventListener('change', onFormChange);
  minPriceEl.addEventListener('input', onFormChange);
  maxPriceEl.addEventListener('input', onFormChange);

  // =============================================
  // SAVE SETTINGS
  // =============================================
  saveBtn.addEventListener('click', () => {
    const url = eventUrlEl.value.trim();

    if (url && !isValidCelticUrl(url)) {
      eventUrlEl.classList.add('input-error');
      urlError.classList.remove('hidden');
      return;
    }

    eventUrlEl.classList.remove('input-error');
    urlError.classList.add('hidden');

    const settings = getFormValues();
    savedSettings = { ...settings };
    settingsChanged = false;

    chrome.storage.local.set({ settings, taskCompleted: false }, () => {
      showToast('Settings saved!');
      saveBtn.disabled = true;
      updateStartButton();
      chrome.runtime.sendMessage({ action: 'settingsUpdated', settings });
    });
  });

  // =============================================
  // START / STOP MONITORING
  // =============================================
  startBtn.addEventListener('click', () => {
    chrome.storage.local.get(['isMonitoring'], (data) => {
      const newState = !data.isMonitoring;

      if (newState) {
        if (!savedSettings || !savedSettings.eventUrl) {
          showToast('Please save a valid event URL first');
          return;
        }

        const startTime = Date.now();
        monitoringStartTime = startTime;

        chrome.storage.local.set({
          isMonitoring: true,
          taskCompleted: false,
          monitoringStartTime: startTime,
          monitoringEndTime: null
        }, () => {
          updateStatus(true, false);
          startDurationTimer();
          // Send to background — it will connect proxy, test, then open event URL
          chrome.runtime.sendMessage({
            action: 'startMonitoring',
            settings: savedSettings
          });
          // Do NOT open tab here — background.js handles it after proxy verification
        });
      } else {
        const endTime = Date.now();
        chrome.storage.local.set({
          isMonitoring: false,
          taskCompleted: false,
          monitoringEndTime: endTime
        }, () => {
          updateStatus(false, false);
          stopDurationTimer();
          chrome.runtime.sendMessage({ action: 'stopMonitoring' });
        });
      }
    });
  });

  // =============================================
  // COMPLETION MODAL
  // =============================================
  modalCloseBtn.addEventListener('click', () => {
    completionModal.classList.add('hidden');
    chrome.storage.local.set({ taskCompleted: false });
  });

  // =============================================
  // STORAGE CHANGE LISTENER
  // =============================================
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    chrome.storage.local.get(
      ['isMonitoring', 'taskCompleted', 'monitoringStartTime', 'monitoringEndTime'],
      (data) => {
        updateStatus(data.isMonitoring, data.taskCompleted);

        if (data.isMonitoring && data.monitoringStartTime && !durationTimer) {
          monitoringStartTime = data.monitoringStartTime;
          startDurationTimer();
        } else if (!data.isMonitoring && durationTimer) {
          stopDurationTimer();
          if (data.monitoringStartTime && data.monitoringEndTime) {
            const elapsed = data.monitoringEndTime - data.monitoringStartTime;
            durationText.textContent = formatDuration(elapsed);
            durationDisplay.classList.remove('hidden');
          }
        }

        if (data.taskCompleted) {
          showCompletionModal(data.monitoringStartTime, data.monitoringEndTime);
        }
      }
    );

    // Refresh logs if on logs tab
    if (changes.logs) {
      const activeTab = document.querySelector('.tab-btn.active');
      if (activeTab && activeTab.dataset.tab === 'logs') {
        loadLogs();
      }
    }
  });

  // =============================================
  // DURATION TIMER
  // =============================================
  function startDurationTimer() {
    stopDurationTimer();
    durationDisplay.classList.remove('hidden');
    updateDurationDisplay();
    durationTimer = setInterval(updateDurationDisplay, 1000);
  }

  function stopDurationTimer() {
    if (durationTimer) {
      clearInterval(durationTimer);
      durationTimer = null;
    }
  }

  function updateDurationDisplay() {
    if (!monitoringStartTime) return;
    const elapsed = Date.now() - monitoringStartTime;
    durationText.textContent = formatDuration(elapsed);
  }

  function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return String(hrs).padStart(2, '0') + ':' +
           String(mins).padStart(2, '0') + ':' +
           String(secs).padStart(2, '0');
  }

  // =============================================
  // LOGS
  // =============================================
  function loadLogs() {
    chrome.storage.local.get(['logs'], (data) => {
      const logs = data.logs || [];
      renderLogs(logs);
    });
  }

  function renderLogs(logs) {
    if (!logs || logs.length === 0) {
      logsContainer.innerHTML = '<div class="logs-empty">No log entries yet. Start monitoring to see activity.</div>';
      return;
    }

    // Show newest first
    const sorted = [...logs].reverse();
    logsContainer.innerHTML = sorted.map(entry => {
      const badgeClass = entry.level || 'info';
      const badgeLabel = badgeClass.toUpperCase();
      const time = new Date(entry.timestamp).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const date = new Date(entry.timestamp).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short'
      });

      return `<div class="log-entry">
        <span class="log-badge ${badgeClass}">${badgeLabel}</span>
        <div class="log-body">
          <span class="log-message">${escapeHtml(entry.message)}</span>
          <span class="log-time">${date} ${time}</span>
        </div>
      </div>`;
    }).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Export logs as a text file
  exportLogsBtn.addEventListener('click', () => {
    chrome.storage.local.get(['logs', 'monitoringStartTime', 'monitoringEndTime'], (data) => {
      const logs = data.logs || [];
      if (logs.length === 0) {
        showToast('No logs to export');
        return;
      }
      let output = '=== Stubby Owl v1.0.1 \u2014 Activity Log ===\n';   output += 'Exported: ' + new Date().toLocaleString('en-GB') + '\n';

      if (data.monitoringStartTime) {
        output += 'Monitoring Started: ' + new Date(data.monitoringStartTime).toLocaleString('en-GB') + '\n';
      }
      if (data.monitoringEndTime) {
        output += 'Monitoring Ended: ' + new Date(data.monitoringEndTime).toLocaleString('en-GB') + '\n';
        if (data.monitoringStartTime) {
          const elapsed = data.monitoringEndTime - data.monitoringStartTime;
          output += 'Total Duration: ' + formatDuration(elapsed) + '\n';
        }
      }

      output += '==========================================\n\n';

      logs.forEach(entry => {
        const ts = new Date(entry.timestamp).toLocaleString('en-GB');
        const level = (entry.level || 'info').toUpperCase().padEnd(7);
        output += `[${ts}] [${level}] ${entry.message}\n`;
      });

      output += '\n=== End of Log ===\n';

      // Create and download the file
      const blob = new Blob([output], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = 'stubbyowl_logs_' +
        new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.txt';
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      showToast('Logs exported!');
    });
  });

  // Clear logs
  clearLogsBtn.addEventListener('click', () => {
    chrome.storage.local.set({ logs: [] }, () => {
      loadLogs();
      showToast('Logs cleared');
    });
  });

  // =============================================
  // HELPER FUNCTIONS
  // =============================================
  function getFormValues() {
    return {
      eventUrl: eventUrlEl.value.trim(),
      quantity: parseInt(quantityEl.value, 10) || 1,
      minPrice: parseInt(minPriceEl.value, 10) || 0,
      maxPrice: parseInt(maxPriceEl.value, 10) || 0
    };
  }

  function isValidCelticUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'www.eticketing.co.uk' &&
             parsed.pathname.startsWith('/celtic');
    } catch (e) {
      return false;
    }
  }

  function hasUnsavedChanges() {
    if (!savedSettings) return true;
    const current = getFormValues();
    return current.eventUrl !== (savedSettings.eventUrl || '') ||
           current.quantity !== (savedSettings.quantity || 1) ||
           current.minPrice !== (savedSettings.minPrice || 0) ||
           current.maxPrice !== (savedSettings.maxPrice || 0);
  }

  function updateStartButton() {
    const hasUrl = savedSettings && savedSettings.eventUrl;
    const hasSaved = !settingsChanged && hasUrl;

    chrome.storage.local.get(['isMonitoring'], (data) => {
      if (data.isMonitoring) {
        startBtn.disabled = false;
      } else {
        startBtn.disabled = !hasSaved;
      }
    });
  }

  function updateStatus(isMonitoring, taskCompleted) {
    statusBar.className = 'status-bar';

    if (taskCompleted) {
      statusBar.classList.add('status-found');
      statusText.textContent = 'Completed — Tickets added to basket!';
      startBtn.textContent = 'Start Monitoring';
      startBtn.classList.remove('btn-stop');
      startBtn.classList.add('gradient-animate');
      updateStartButton();
    } else if (isMonitoring) {
      statusBar.classList.add('status-active');
      statusText.textContent = 'Active — Monitoring for tickets';
      startBtn.textContent = 'Stop Monitoring';
      startBtn.disabled = false;
      startBtn.classList.remove('gradient-animate');
      startBtn.classList.add('btn-stop');
    } else {
      statusBar.classList.add('status-idle');
      statusText.textContent = 'Idle — Not monitoring';
      startBtn.textContent = 'Start Monitoring';
      startBtn.classList.remove('btn-stop');
      startBtn.classList.add('gradient-animate');
      updateStartButton();
      // Hide duration when idle with no history
      chrome.storage.local.get(['monitoringStartTime'], (data) => {
        if (!data.monitoringStartTime) {
          durationDisplay.classList.add('hidden');
        }
      });
    }
  }

  function showCompletionModal(startTime, endTime) {
    completionModal.classList.remove('hidden');
    if (startTime && endTime) {
      const elapsed = endTime - startTime;
      modalDuration.textContent = 'Total duration: ' + formatDuration(elapsed);
    } else {
      modalDuration.textContent = '';
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('visible');
    setTimeout(() => {
      toast.classList.remove('visible');
      toast.classList.add('hidden');
    }, 2000);
  }

  // =============================================
  // PROXY TAB — Multi-Proxy List with Edit & Auto-Parse
  // =============================================
  let editingProxyIndex = -1; // -1 = adding new, >= 0 = editing existing

  function loadProxyState() {
    chrome.storage.local.get(['proxyList', 'proxyConnected', 'proxyActiveIndex', 'proxyConflict'], (data) => {
      const list = data.proxyList || [];
      renderProxyList(list, data.proxyConnected || false, data.proxyActiveIndex ?? -1);

      // Show/hide proxy conflict warning
      if (data.proxyConflict) {
        proxyConflictWarning.classList.remove('hidden');
        // Also check for details from background
        chrome.runtime.sendMessage({ action: 'checkProxyControl' }, (result) => {
          if (result && !result.inControl) {
            proxyConflictText.textContent = result.details;
            proxyConflictWarning.classList.remove('hidden');
          } else {
            proxyConflictWarning.classList.add('hidden');
          }
        });
      } else {
        proxyConflictWarning.classList.add('hidden');
      }
    });
  }

  function renderProxyList(list, connected, activeIndex) {
    proxyCountEl.textContent = list.length;

    if (list.length === 0) {
      proxyListEl.innerHTML = '<div class="proxy-list-empty">No proxies added yet. Add a proxy below.</div>';
      proxyStatusEl.className = 'proxy-status proxy-disconnected';
      proxyStatusText.textContent = 'No proxies configured';
      return;
    }

    if (connected && activeIndex >= 0 && activeIndex < list.length) {
      proxyStatusEl.className = 'proxy-status proxy-connected';
      const active = list[activeIndex];
      proxyStatusText.textContent = 'Active: #' + (activeIndex + 1) + ' \u2014 ' + active.host + ':' + active.port;
    } else {
      proxyStatusEl.className = 'proxy-status proxy-disconnected';
      proxyStatusText.textContent = list.length + ' proxy(s) ready \u2014 auto-connects on monitoring start';
    }

    proxyListEl.innerHTML = list.map((p, i) => {
      const isActive = connected && i === activeIndex;
      const isEditing = i === editingProxyIndex;
      const activeClass = isActive ? ' proxy-item-active' : '';
      const editClass = isEditing ? ' proxy-item-editing' : '';
      const label = p.host + ':' + p.port;
      const proto = (p.protocol || 'http').toUpperCase();
      const authIcon = (p.username && p.password) ? ' &#128274;' : '';
      return '<div class="proxy-item' + activeClass + editClass + '" data-index="' + i + '">' +
        '<div class="proxy-item-info proxy-item-clickable" data-index="' + i + '">' +
          '<span class="proxy-item-index">#' + (i + 1) + '</span>' +
          '<span class="proxy-item-badge">' + proto + '</span>' +
          '<span class="proxy-item-label">' + escapeHtml(label) + authIcon + '</span>' +
          (isActive ? '<span class="proxy-item-active-badge">ACTIVE</span>' : '') +
          (isEditing ? '<span class="proxy-item-edit-badge">EDITING</span>' : '') +
        '</div>' +
        '<button class="proxy-item-remove btn-icon" data-index="' + i + '" title="Remove">' +
          '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">' +
            '<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />' +
          '</svg>' +
        '</button>' +
      '</div>';
    }).join('');

    // Attach click-to-edit handlers
    proxyListEl.querySelectorAll('.proxy-item-clickable').forEach(el => {
      el.addEventListener('click', (e) => {
        const idx = parseInt(el.dataset.index, 10);
        editProxy(idx, list);
      });
    });

    // Attach remove handlers
    proxyListEl.querySelectorAll('.proxy-item-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        removeProxy(idx);
      });
    });
  }

  /**
   * Load a proxy into the form for editing.
   */
  function editProxy(index, list) {
    if (index < 0 || index >= list.length) return;
    const p = list[index];
    editingProxyIndex = index;

    proxyProtocolEl.value = p.protocol || 'http';
    proxyHostEl.value = p.host || '';
    proxyPortEl.value = p.port || '';
    proxyUserEl.value = p.username || '';
    proxyPassEl.value = p.password || '';

    // Change button text to "Update Proxy"
    proxyAddBtn.innerHTML =
      '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style="vertical-align:-2px;margin-right:4px">' +
        '<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />' +
      '</svg>' +
      'Update Proxy #' + (index + 1);

    // Re-render to highlight the editing item
    loadProxyState();
  }

  /**
   * Reset form to "Add" mode.
   */
  function resetProxyForm() {
    editingProxyIndex = -1;
    proxyProtocolEl.value = 'http';
    proxyHostEl.value = '';
    proxyPortEl.value = '';
    proxyUserEl.value = '';
    proxyPassEl.value = '';
    proxyAddBtn.innerHTML =
      '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style="vertical-align:-2px;margin-right:4px">' +
        '<path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />' +
      '</svg>' +
      'Add Proxy';
  }

  /**
   * Auto-parse proxy string: Host:Port:Username:Password
   * Triggered on paste or input change in the hostname field.
   */
  function tryAutoParseProxy(value) {
    const trimmed = value.trim();
    // Match patterns like host:port:user:pass or host:port
    const parts = trimmed.split(':');
    if (parts.length >= 2) {
      const portCandidate = parts[1];
      // Check if second part is a valid port number
      const portNum = parseInt(portCandidate, 10);
      if (!isNaN(portNum) && portNum >= 1 && portNum <= 65535) {
        proxyHostEl.value = parts[0];
        proxyPortEl.value = portNum;
        if (parts.length >= 3) {
          proxyUserEl.value = parts[2];
        }
        if (parts.length >= 4) {
          proxyPassEl.value = parts.slice(3).join(':'); // Password may contain colons
        }
        showToast('Proxy line auto-parsed!');
        return true;
      }
    }
    return false;
  }

  // Auto-parse on paste into hostname field
  proxyHostEl.addEventListener('paste', (e) => {
    // Use a short delay to let the paste complete
    setTimeout(() => {
      tryAutoParseProxy(proxyHostEl.value);
    }, 50);
  });

  // Also auto-parse on blur if the value contains colons
  proxyHostEl.addEventListener('blur', () => {
    const val = proxyHostEl.value.trim();
    if (val.includes(':')) {
      tryAutoParseProxy(val);
    }
  });

  // Add or Update proxy
  proxyAddBtn.addEventListener('click', () => {
    const host = proxyHostEl.value.trim();
    const port = proxyPortEl.value.trim();

    if (!host) {
      proxyHostEl.classList.add('input-error');
      showToast('Please enter a hostname');
      return;
    }
    proxyHostEl.classList.remove('input-error');

    if (!port) {
      proxyPortEl.classList.add('input-error');
      showToast('Please enter a port');
      return;
    }
    proxyPortEl.classList.remove('input-error');

    const proxyData = {
      protocol: proxyProtocolEl.value,
      host: host,
      port: parseInt(port, 10),
      username: proxyUserEl.value.trim(),
      password: proxyPassEl.value
    };

    chrome.storage.local.get(['proxyList'], (data) => {
      const list = data.proxyList || [];

      if (editingProxyIndex >= 0 && editingProxyIndex < list.length) {
        // Update existing proxy
        list[editingProxyIndex] = proxyData;
        chrome.storage.local.set({ proxyList: list }, () => {
          showToast('Proxy #' + (editingProxyIndex + 1) + ' updated');
          resetProxyForm();
          loadProxyState();
        });
      } else {
        // Add new proxy
        list.push(proxyData);
        chrome.storage.local.set({ proxyList: list }, () => {
          showToast('Proxy #' + list.length + ' added');
          resetProxyForm();
          loadProxyState();
        });
      }
    });
  });

  function removeProxy(index) {
    chrome.storage.local.get(['proxyList'], (data) => {
      const list = data.proxyList || [];
      if (index >= 0 && index < list.length) {
        const removed = list.splice(index, 1)[0];
        // If we were editing this one, reset form
        if (editingProxyIndex === index) {
          resetProxyForm();
        } else if (editingProxyIndex > index) {
          editingProxyIndex--; // Adjust index
        }
        chrome.storage.local.set({ proxyList: list }, () => {
          showToast('Removed ' + removed.host + ':' + removed.port);
          loadProxyState();
        });
      }
    });
  }

  // Clear all proxies
  proxyClearBtn.addEventListener('click', () => {
    chrome.storage.local.set({ proxyList: [], proxyActiveIndex: -1 }, () => {
      resetProxyForm();
      chrome.runtime.sendMessage({ action: 'proxyDisconnect' }, () => {
        showToast('All proxies cleared');
        loadProxyState();
      });
    });
  });

  // Listen for proxy state changes to update the UI
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.proxyConnected || changes.proxyActiveIndex || changes.proxyList || changes.proxyConflict)) {
      const activeTab = document.querySelector('.tab-btn.active');
      if (activeTab && activeTab.dataset.tab === 'proxy') {
        loadProxyState();
      }
    }
  });

  // Load proxy state on init
  loadProxyState();
});
