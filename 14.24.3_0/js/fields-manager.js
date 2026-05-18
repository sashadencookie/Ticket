// Auto-generated fields manager for NFilL Automator options page.
// Reads/writes profiles from chrome.storage.local, renders rows in #content-fields-body,
// wires add / delete / move-up / move-down / search / category-filter.
// CSP-safe: external script, no inline code, no eval.
(function () {
  'use strict';

  var STORAGE_KEY = 'fieldProfiles';
  var CATS_KEY = 'fieldCategories';

  var TYPES = ['text', 'email', 'tel', 'number', 'password', 'url', 'date', 'checkbox', 'radio', 'select', 'textarea'];
  var MODES = ['exact', 'contains', 'regex', 'css'];

  var state = {
    fields: [],
    categories: [],
    activeCategory: 'all',
    searchTerm: '',
    searchVisible: false,
  };

  function $(id) { return document.getElementById(id); }

  function load(cb) {
    if (!(chrome && chrome.storage && chrome.storage.local)) { cb(); return; }
    chrome.storage.local.get([STORAGE_KEY, CATS_KEY], function (data) {
      state.fields = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      state.categories = Array.isArray(data[CATS_KEY]) ? data[CATS_KEY] : [];
      cb();
    });
  }

  function persist() {
    if (!(chrome && chrome.storage && chrome.storage.local)) return;
    var payload = {};
    payload[STORAGE_KEY] = state.fields;
    payload[CATS_KEY] = state.categories;
    chrome.storage.local.set(payload);
  }

  function makeSelect(options, value, className) {
    var sel = document.createElement('select');
    sel.className = className || '';
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
    inp.value = value || '';
    if (placeholder) inp.placeholder = placeholder;
    if (className) inp.className = className;
    return inp;
  }

  function makeIconButton(label, title) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.className = 'row-action';
    return btn;
  }

  function rowMatches(field) {
    // category filter
    if (state.activeCategory === 'all') {
      // pass
    } else if (state.activeCategory === '') {
      if (field.category && field.category !== '') return false;
    } else {
      if ((field.category || '') !== state.activeCategory) return false;
    }
    // search filter
    if (state.searchTerm) {
      var hay = ((field.name || '') + ' ' + (field.value || '') + ' ' + (field.site || '')).toLowerCase();
      if (hay.indexOf(state.searchTerm.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function renderRow(field, index) {
    var tr = document.createElement('tr');
    tr.dataset.index = String(index);

    // Type
    var tdType = document.createElement('td');
    var typeSel = makeSelect(TYPES, field.type || 'text');
    typeSel.addEventListener('change', function () {
      state.fields[index].type = typeSel.value;
      persist();
    });
    tdType.appendChild(typeSel);
    tr.appendChild(tdType);

    // Name
    var tdName = document.createElement('td');
    var nameInp = makeInput(field.name, 'name');
    nameInp.addEventListener('input', function () {
      state.fields[index].name = nameInp.value;
      persist();
    });
    tdName.appendChild(nameInp);
    tr.appendChild(tdName);

    // Value
    var tdValue = document.createElement('td');
    var valInp = makeInput(field.value, 'value');
    valInp.addEventListener('input', function () {
      state.fields[index].value = valInp.value;
      persist();
    });
    tdValue.appendChild(valInp);
    tr.appendChild(tdValue);

    // Site
    var tdSite = document.createElement('td');
    var siteInp = makeInput(field.site, 'site (e.g. *.example.com)');
    siteInp.addEventListener('input', function () {
      state.fields[index].site = siteInp.value;
      persist();
    });
    tdSite.appendChild(siteInp);
    tr.appendChild(tdSite);

    // Mode
    var tdMode = document.createElement('td');
    var modeSel = makeSelect(MODES, field.mode || 'exact');
    modeSel.addEventListener('change', function () {
      state.fields[index].mode = modeSel.value;
      persist();
    });
    tdMode.appendChild(modeSel);
    tr.appendChild(tdMode);

    // Actions: move up, move down, delete
    var tdAct = document.createElement('td');
    tdAct.className = 'row-actions';

    var upBtn = makeIconButton('▲', 'Move up');
    upBtn.addEventListener('click', function () { moveField(index, -1); });

    var downBtn = makeIconButton('▼', 'Move down');
    downBtn.addEventListener('click', function () { moveField(index, 1); });

    var delBtn = makeIconButton('✕', 'Delete');
    delBtn.classList.add('row-delete');
    delBtn.addEventListener('click', function () { deleteField(index); });

    tdAct.appendChild(upBtn);
    tdAct.appendChild(downBtn);
    tdAct.appendChild(delBtn);
    tr.appendChild(tdAct);

    return tr;
  }

  function render() {
    var body = $('content-fields-body');
    if (!body) return;
    body.textContent = '';

    var any = false;
    for (var i = 0; i < state.fields.length; i++) {
      if (!rowMatches(state.fields[i])) continue;
      body.appendChild(renderRow(state.fields[i], i));
      any = true;
    }

    if (!any) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'empty-row';
      td.textContent = state.fields.length === 0 ? 'No fields yet. Click + to add one.' : 'No fields match the current filter.';
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  function addField() {
    var newField = {
      type: 'text',
      name: '',
      value: '',
      site: '',
      mode: 'exact',
      category: state.activeCategory && state.activeCategory !== 'all' && state.activeCategory !== '' ? state.activeCategory : '',
    };
    state.fields.push(newField);
    persist();
    render();
    // Focus the new row's name field
    var body = $('content-fields-body');
    var rows = body.querySelectorAll('tr');
    if (rows.length) {
      var last = rows[rows.length - 1];
      var nameInp = last.querySelector('td:nth-child(2) input');
      if (nameInp) nameInp.focus();
    }
  }

  function deleteField(index) {
    state.fields.splice(index, 1);
    persist();
    render();
  }

  function moveField(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= state.fields.length) return;
    var tmp = state.fields[target];
    state.fields[target] = state.fields[index];
    state.fields[index] = tmp;
    persist();
    render();
  }

  function rebuildCategoriesSelect() {
    var sel = $('content-cats');
    if (!sel) return;
    var current = state.activeCategory;
    // Keep meta options (with data-i18n or value starting with _, or 'all', or value=''), remove user entries
    var keep = [];
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      if (o.disabled || o.value === 'all' || o.value === '' || o.value.indexOf('_') === 0) {
        keep.push(o);
      }
    }
    sel.textContent = '';
    keep.forEach(function (o) { sel.appendChild(o); });
    // Append user categories
    state.categories.forEach(function (cat) {
      var opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      sel.appendChild(opt);
    });
    // Restore selection if still present
    var found = false;
    for (var j = 0; j < sel.options.length; j++) {
      if (sel.options[j].value === current) { sel.selectedIndex = j; found = true; break; }
    }
    if (!found) { sel.value = 'all'; state.activeCategory = 'all'; }
  }

  function handleCategoryChange() {
    var sel = $('content-cats');
    if (!sel) return;
    var v = sel.value;
    if (v === '_label') { sel.value = state.activeCategory; return; }
    if (v === '_catman') {
      manageCategories();
      sel.value = state.activeCategory;
      return;
    }
    state.activeCategory = v;
    render();
  }

  function manageCategories() {
    var current = state.categories.join(', ');
    var input = window.prompt('Manage categories (comma-separated). Existing fields keep their category even if you remove the name here.', current);
    if (input === null) return;
    var list = input.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    // de-dupe, preserve order
    var seen = {};
    state.categories = list.filter(function (c) { if (seen[c]) return false; seen[c] = true; return true; });
    persist();
    rebuildCategoriesSelect();
    render();
  }

  function toggleSearch() {
    var form = $('content-search');
    var box = $('content-searchbox');
    if (!form || !box) return;
    state.searchVisible = !state.searchVisible;
    form.style.display = state.searchVisible ? '' : 'none';
    if (state.searchVisible) {
      box.focus();
    } else {
      box.value = '';
      state.searchTerm = '';
      render();
    }
  }

  function bind() {
    var addBtn = $('button-add');
    if (addBtn) addBtn.addEventListener('click', function (e) { e.preventDefault(); addField(); });

    var searchBtn = $('button-search');
    if (searchBtn) searchBtn.addEventListener('click', function (e) { e.preventDefault(); toggleSearch(); });

    var searchForm = $('content-search');
    if (searchForm) searchForm.addEventListener('submit', function (e) { e.preventDefault(); });

    var searchBox = $('content-searchbox');
    if (searchBox) {
      searchBox.addEventListener('input', function () {
        state.searchTerm = searchBox.value;
        render();
      });
    }

    var cats = $('content-cats');
    if (cats) cats.addEventListener('change', handleCategoryChange);

    var manage = $('button-manage');
    if (manage) manage.addEventListener('click', function (e) { e.preventDefault(); manageCategories(); });

    // hide search bar until toggled
    if (searchForm) searchForm.style.display = 'none';
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    bind();
    load(function () {
      rebuildCategoriesSelect();
      render();
    });
  });
})();
