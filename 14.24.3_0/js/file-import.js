// File import for NFilL Automator: XLSX / CSV / JSON
// Activated from the Sync tab "#button-import" button.
(function () {
  'use strict';

  var STORAGE_KEY = 'fieldProfiles';

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, isError) {
    var status = $('status');
    if (!status) { console.log(msg); return; }
    var span = status.querySelector('span') || status;
    span.textContent = msg;
    span.style.color = isError ? '#c00' : '';
    status.classList.add('show');
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(function () { status.classList.remove('show'); }, 2500);
  }

  function loadXlsxLib(cb) {
    if (window.XLSX) return cb();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = function () { cb(); };
    s.onerror = function () { setStatus('Failed to load XLSX library', true); };
    document.head.appendChild(s);
  }

  // Convert array-of-objects -> field rows
  function rowsToFields(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || typeof r !== 'object') continue;
      var name = r.name != null ? String(r.name) : '';
      var value = r.value != null ? String(r.value) : '';
      if (!name && !value) continue;
      out.push({
        type: r.type ? String(r.type) : 'text',
        name: name,
        value: value,
        site: r.site != null ? String(r.site) : '',
        category: r.category != null ? String(r.category) : '',
      });
    }
    return out;
  }

  function parseJSON(text) {
    var data = JSON.parse(text);
    // Accept either an array, or { fieldProfiles: [...] }
    var rows = Array.isArray(data) ? data : (Array.isArray(data.fieldProfiles) ? data.fieldProfiles : []);
    return rowsToFields(rows);
  }

  function parseSheet(arrayBuffer) {
    var wb = window.XLSX.read(arrayBuffer, { type: 'array' });
    var sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    var sheet = wb.Sheets[sheetName];
    var rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return rowsToFields(rows);
  }

  function readFile(file, asText) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      if (asText) reader.readAsText(file);
      else reader.readAsArrayBuffer(file);
    });
  }

  function applyImport(newFields) {
    if (!(chrome && chrome.storage && chrome.storage.local)) {
      setStatus('Chrome storage unavailable', true); return;
    }
    var replace = !!($('radio-replace') && $('radio-replace').checked);
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      var existing = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      var merged = replace ? newFields : existing.concat(newFields);
      var payload = {};
      payload[STORAGE_KEY] = merged;
      chrome.storage.local.set(payload, function () {
        setStatus('Imported ' + newFields.length + ' field(s)');
      });
    });
  }

  async function handleFile(file) {
    if (!file) return;
    var name = (file.name || '').toLowerCase();
    try {
      var fields;
      if (name.endsWith('.json')) {
        var text = await readFile(file, true);
        fields = parseJSON(text);
      } else if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) {
        await new Promise(function (r) { loadXlsxLib(r); });
        var buf = await readFile(file, false);
        fields = parseSheet(buf);
      } else {
        setStatus('Unsupported file type. Use .xlsx, .csv, or .json', true);
        return;
      }
      if (!fields.length) {
        setStatus('No valid rows found in file', true);
        return;
      }
      applyImport(fields);
    } catch (err) {
      console.error(err);
      setStatus('Import failed: ' + (err && err.message ? err.message : err), true);
    }
  }

  function init() {
    var btn = $('button-import');
    var fileInput = $('file-import');
    if (!btn || !fileInput) return;

    // Widen accepted types
    fileInput.setAttribute('accept', '.csv,.xlsx,.xls,.json,application/json');

    // The original button may not be wired (the Sheets script handled it). Force-wire it.
    btn.disabled = false;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      handleFile(f);
      // reset so picking the same file again retriggers change
      fileInput.value = '';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
