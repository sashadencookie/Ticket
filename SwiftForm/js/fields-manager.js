// Fields manager for NFilL Automator options page.
// - Renders rule rows in #content-fields-body (Type, Name, Value, Site only)
// - Mode column removed per UX
// - Does NOT react to external storage changes (prevents profile from "switching")
// - Auto-persists on edit
(function () {
  'use strict';

  var STORAGE_KEY = 'fieldProfiles';
  var CATS_KEY = 'fieldCategories';
  var ACTIVE_CAT_KEY = 'activeCategory';

  var TYPES = ['text', 'email', 'tel', 'number', 'password', 'url', 'date', 'checkbox', 'radio', 'select', 'textarea'];

  var state = {
    fields: [],
    categories: [],
    activeCategory: 'all',
    searchTerm: '',
    searchVisible: false,
    initialized: false,
  };

  // Flag used to suppress our own storage echoes, in case any other code listens.
  var writingSelf = false;

  function $(id) { return document.getElementById(id); }

  function load(cb) {
    if (!(chrome && chrome.storage && chrome.storage.local)) { cb && cb(); return; }
    chrome.storage.local.get([STORAGE_KEY, CATS_KEY, ACTIVE_CAT_KEY], function (data) {
      state.fields = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      state.categories = Array.isArray(data[CATS_KEY]) ? data[CATS_KEY] : [];
      if (typeof data[ACTIVE_CAT_KEY] === 'string') state.activeCategory = data[ACTIVE_CAT_KEY];
      cb && cb();
    });
  }

  function persist() {
    if (!(chrome && chrome.storage && chrome.storage.local)) return;
    var payload = {};
    payload[STORAGE_KEY] = state.fields;
    payload[CATS_KEY] = state.categories;
    payload[ACTIVE_CAT_KEY] = state.activeCategory;
    writingSelf = true;
    chrome.storage.local.set(payload, function () {
      writingSelf = false;
      flashSaved();
    });
  }

  function flashSaved() {
    var status = $('status');
    if (!status) return;
    var span = status.querySelector('span') || status;
    span.textContent = 'Saved';
    status.classList.add('show');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(function () { status.classList.remove('show'); span.textContent = ''; }, 1200);
  }

  function makeSelect(options, value, className) {
    var sel = document.createElement('select');
    if (className) sel.className = className;
    for (var i = 0; i < options.length; i++) {
      var opt = document.createElement('option');
      opt.value = options[i];
      opt.textContent = options[i];
      if (options[i] === value) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  function makeInput(value, placeholder, className) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value == null ? '' : value;
    if (placeholder) inp.placeholder = placeholder;
    if (className) inp.className = className;
    return inp;
  }

  function makeBtn(label, title, className) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (title) b.title = title;
    if (className) b.className = className;
    return b;
  }

  function matchesFilter(field) {
    if (state.activeCategory !== 'all') {
      if (state.activeCategory === '') {
        if (field.category && field.category !== '') return false;
      } else if ((field.category || '') !== state.activeCategory) {
        return false;
      }
    }
    if (state.searchTerm) {
      var t = state.searchTerm.toLowerCase();
      var hay = ((field.name || '') + ' ' + (field.value || '') + ' ' + (field.site || '')).toLowerCase();
      if (hay.indexOf(t) === -1) return false;
    }
    return true;
  }

  function render() {
    var body = $('content-fields-body');
    if (!body) return;
    body.textContent = '';

    for (var i = 0; i < state.fields.length; i++) {
      (function (idx) {
        var f = state.fields[idx];
        if (!matchesFilter(f)) return;

        var tr = document.createElement('tr');

        // Type
        var td1 = document.createElement('td');
        var typeSel = makeSelect(TYPES, f.type || 'text');
        typeSel.addEventListener('change', function () { state.fields[idx].type = typeSel.value; persist(); });
        td1.appendChild(typeSel);
        tr.appendChild(td1);

        // Name
        var td2 = document.createElement('td');
        var nameInp = makeInput(f.name, 'field name or id');
        nameInp.addEventListener('change', function () { state.fields[idx].name = nameInp.value; persist(); });
        td2.appendChild(nameInp);
        tr.appendChild(td2);

        // Value
        var td3 = document.createElement('td');
        var valInp = makeInput(f.value, 'value to fill');
        valInp.addEventListener('change', function () { state.fields[idx].value = valInp.value; persist(); });
        td3.appendChild(valInp);
        tr.appendChild(td3);

        // Site
        var td4 = document.createElement('td');
        var siteInp = makeInput(f.site, 'site (optional)');
        siteInp.addEventListener('change', function () { state.fields[idx].site = siteInp.value; persist(); });
        td4.appendChild(siteInp);
        tr.appendChild(td4);

        // Action cell (delete)
        var tdA = document.createElement('td');
        tdA.className = 'col-action';
        var del = makeBtn('×', 'Delete', 'btn-del');
        del.addEventListener('click', function () {
          state.fields.splice(idx, 1);
          persist();
          render();
        });
        tdA.appendChild(del);
        tr.appendChild(tdA);

        body.appendChild(tr);
      })(i);
    }
  }

  function renderCategoryOptions() {
    var sel = $('content-cats');
    if (!sel) return;
    // Keep the special static <option>s already in HTML; only refresh category list.
    // Remove any previously-added dynamic options (we tag them with data-dyn="1")
    var dyn = sel.querySelectorAll('option[data-dyn="1"]');
    for (var i = 0; i < dyn.length; i++) dyn[i].remove();
    // Append categories
    for (var j = 0; j < state.categories.length; j++) {
      var o = document.createElement('option');
      o.value = state.categories[j];
      o.textContent = state.categories[j];
      o.setAttribute('data-dyn', '1');
      sel.appendChild(o);
    }
    // Set selection
    var allowed = ['all', ''];
    if (allowed.indexOf(state.activeCategory) === -1 && state.categories.indexOf(state.activeCategory) === -1) {
      state.activeCategory = 'all';
    }
    sel.value = state.activeCategory;
  }

  function bindUI() {
    var addBtn = $('button-add');
    if (addBtn) addBtn.addEventListener('click', function () {
      state.fields.push({ type: 'text', name: '', value: '', site: '', category: state.activeCategory === 'all' ? '' : state.activeCategory });
      persist();
      render();
    });

    var searchBtn = $('button-search');
    var searchForm = $('content-search');
    var searchBox = $('content-searchbox');
    if (searchBtn && searchForm) {
      searchForm.style.display = 'none';
      searchBtn.addEventListener('click', function () {
        state.searchVisible = !state.searchVisible;
        searchForm.style.display = state.searchVisible ? '' : 'none';
        if (state.searchVisible && searchBox) searchBox.focus();
        if (!state.searchVisible) { state.searchTerm = ''; if (searchBox) searchBox.value = ''; render(); }
      });
    }
    if (searchBox) {
      searchBox.addEventListener('input', function () { state.searchTerm = searchBox.value || ''; render(); });
      if (searchForm) searchForm.addEventListener('submit', function (e) { e.preventDefault(); });
    }

    var cats = $('content-cats');
    if (cats) {
      cats.addEventListener('change', function () {
        var v = cats.value;
        // Skip non-filter sentinels
        if (v === '_label' || v === '_catman') { cats.value = state.activeCategory; return; }
        state.activeCategory = v;
        persist();
        render();
      });
    }

    var saveBtn = $('button-save');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        persist(); // already auto-saving but give the user the feedback they expect
      });
    }

    var resetBtn = $('button-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!confirm('Reset all field profiles? This cannot be undone.')) return;
        state.fields = [];
        state.categories = [];
        state.activeCategory = 'all';
        persist();
        renderCategoryOptions();
        render();
      });
    }
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    load(function () {
      bindUI();
      renderCategoryOptions();
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
