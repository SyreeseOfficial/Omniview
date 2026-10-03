'use strict';

// ═══════════════════════════════════════════ STATE ══
const state = {
  view: 'browse',
  layout: localStorage.getItem('omniview-layout') || 'gallery',
  entries: [],
  boards: [],
  tags: [],
  types: [],
  foundVia: [],
  filters: { q: '', type: '', tags: [], board: '', favorite: false, tagMode: 'any' },
  sort: 'newest',
  bulkMode: false,
  selectedIds: new Set(),
  editingEntry: null,
  currentBoard: null,
  pendingScreenshotFile: null,
  detailEntry: null,
};

// ═══════════════════════════════════════════ API ══
const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async uploadScreenshot(entryId, file) {
    const fd = new FormData();
    fd.append('screenshot', file);
    const r = await fetch(`/api/entries/${entryId}/screenshot`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
};

// ═══════════════════════════════════════════ INIT ══
async function init() {
  loadPersistedFilters();
  await loadAll();
  ['f-type', 'detail-type'].forEach(id => initCombo(id, 'type'));
  ['f-color', 'detail-color'].forEach(id => initCombo(id, 'color'));
  ['f-found-via', 'detail-found-via'].forEach(id => initCombo(id, 'foundVia'));
  setupNav();
  setupTheme();
  setupSidebarCollapse();
  setupKeyboardShortcuts();
  setupSearch();
  setupFilters();
  setupLayoutSwitch();
  setupBulk();
  setupAddForm();
  setupDetailModal();
  setupConfirmModal();
  setupBoardPicker();
  setupSettings();
  setupPasteImage();
  renderBrowse();
  refreshStats();

  window.addEventListener('beforeunload', e => {
    if (isFormDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

// ═══════════════════════════════════════════ PASTE IMAGE ══
function setupPasteImage() {
  document.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const item = [...items].find(i => i.type && i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    if (state.detailEntry && document.getElementById('detail-overlay').style.display !== 'none') {
      applyDetailScreenshot(file);
    } else if (state.view === 'add') {
      setScreenshotPreview(file);
    }
  });
}

async function loadAll() {
  [state.entries, state.boards, state.tags, state.types, state.foundVia] = await Promise.all([
    api.get('/api/entries'),
    api.get('/api/boards'),
    api.get('/api/tags'),
    api.get('/api/types'),
    api.get('/api/found-via')
  ]);
  document.getElementById('browse-loading').style.display = 'none';
}

// ═══════════════════════════════════════════ COMBO DROPDOWNS (Type / Color / Found via) ══
// A single-select dropdown built from the Style Tags widget's own classes, so
// every option field in the app shares one look. It is custom rather than a
// native <select> because a <select> cannot host a per-option delete button.
const COLORS = ['Black', 'White', 'Gray', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Brown', 'Multicolor'];

const CARET_SVG = '<svg class="filter-caret" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Blank-image mark shown wherever an entry has no uploaded screenshot.
const PLACEHOLDER_SVG = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="2" y="5" width="24" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="12" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M2 19l7-5 4 3.5 3.5-2.5 9.5 6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

// Each kind says where its options live and — when the list is user-managed —
// how to add or remove one. Colors are a fixed list, so they get neither.
const COMBO_KINDS = {
  type: {
    getOptions: () => state.types,
    promptLabel: 'New type name:',
    add: ensureType,
    remove: deleteTypeOption,
    usage: name => state.entries.filter(e => e.type === name).length
  },
  foundVia: {
    getOptions: () => state.foundVia,
    promptLabel: 'New "found via" name:',
    add: ensureFoundVia,
    remove: deleteFoundViaOption,
    usage: name => state.entries.filter(e => e.found_via === name).length
  },
  color: { getOptions: () => COLORS }
};

const combos = {};

function initCombo(id, kindName) {
  const root = document.getElementById(id);
  root.innerHTML =
    `<div class="combo-field" tabindex="0"><span class="combo-value"></span>${CARET_SVG}</div>` +
    '<div class="combo-dropdown tag-dropdown" style="display:none"></div>';

  combos[id] = { root, kind: COMBO_KINDS[kindName], value: '' };

  const field = root.querySelector('.combo-field');
  field.addEventListener('click', () => (isComboOpen(id) ? closeCombo(id) : openCombo(id)));
  field.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCombo(id); }
    if (e.key === 'Escape') closeCombo(id);
  });
  document.addEventListener('click', e => { if (!root.contains(e.target)) closeCombo(id); });
  setCombo(id, '');
}

function comboValue(id) { return combos[id].value; }

function setCombo(id, value) {
  const c = combos[id];
  c.value = value || '';
  const label = c.root.querySelector('.combo-value');
  label.textContent = c.value || '— None —';
  label.classList.toggle('is-empty', !c.value);
  c.root.classList.toggle('has-value', !!c.value);
  if (isComboOpen(id)) renderComboList(id);
}

function isComboOpen(id) { return combos[id].root.querySelector('.combo-dropdown').style.display !== 'none'; }
function openCombo(id) { combos[id].root.querySelector('.combo-dropdown').style.display = ''; renderComboList(id); }
function closeCombo(id) { combos[id].root.querySelector('.combo-dropdown').style.display = 'none'; }

function renderComboList(id) {
  const c = combos[id];
  const dd = c.root.querySelector('.combo-dropdown');
  dd.innerHTML = '';

  if (c.kind.add) {
    const addNew = document.createElement('div');
    addNew.className = 'tag-dropdown-item create';
    addNew.textContent = '+ Add New';
    addNew.addEventListener('click', async () => {
      const name = (prompt(c.kind.promptLabel) || '').trim();
      closeCombo(id);
      if (!name) return;
      await c.kind.add(name);
      setCombo(id, name);
    });
    dd.appendChild(addNew);
  }

  const none = document.createElement('div');
  none.className = 'tag-dropdown-item' + (c.value ? '' : ' selected');
  none.textContent = '— None —';
  none.addEventListener('click', () => { setCombo(id, ''); closeCombo(id); });
  dd.appendChild(none);

  // The current value is merged in even when it is no longer a listed option,
  // so opening an older entry never silently drops what it already had.
  const options = [...c.kind.getOptions()];
  if (c.value && !options.includes(c.value)) options.push(c.value);

  options.sort((a, b) => a.localeCompare(b)).forEach(name => {
    const item = document.createElement('div');
    item.className = 'tag-dropdown-item' + (name === c.value ? ' selected' : '');
    const label = document.createElement('span');
    label.textContent = name;
    item.appendChild(label);
    item.addEventListener('click', () => { setCombo(id, name); closeCombo(id); });

    if (c.kind.remove) item.appendChild(optionDeleteBtn(name, c.kind.usage(name), c.kind.remove, () => closeCombo(id)));
    dd.appendChild(item);
  });
}

// The "✕" on a dropdown row. Always routes through the confirm modal, which
// states how many entries lose the value before anything is removed.
function optionDeleteBtn(name, used, remove, beforeConfirm) {
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'dropdown-del';
  del.textContent = '✕';
  del.title = `Delete "${name}"`;
  del.addEventListener('click', e => {
    e.stopPropagation();
    if (beforeConfirm) beforeConfirm();
    confirmOptionDelete(name, used, () => remove(name));
  });
  return del;
}

// Shared by every place an option can be deleted (combo dropdowns, the Style
// Tags dropdown, and the Settings lists) so the warning is written once.
function confirmOptionDelete(name, used, run) {
  const tail = used
    ? `It will be removed from ${used} ${used === 1 ? 'entry' : 'entries'}.`
    : 'No entries use it.';
  confirm_(`Delete "${name}"? ${tail}`, run);
}

// Re-renders open combos after the option list changed, and clears the value
// from any combo still showing something that was just deleted.
function syncOptionUI(removed) {
  Object.keys(combos).forEach(id => {
    if (removed && combos[id].value === removed) setCombo(id, '');
    else if (isComboOpen(id)) renderComboList(id);
  });
  renderTagList();
  renderTypeList();
  renderFoundViaList();
}

// ─── Option mutations (one place per list, shared by combos and Settings) ────
async function ensureType(value) {
  const val = (value || '').trim();
  if (!val || state.types.some(t => t.toLowerCase() === val.toLowerCase())) return;
  state.types.push(val);
  try { await api.post('/api/types', { name: val }); } catch { /* already exists server-side */ }
  syncOptionUI();
}

async function ensureFoundVia(value) {
  const val = (value || '').trim();
  if (!val || state.foundVia.some(t => t.toLowerCase() === val.toLowerCase())) return;
  state.foundVia.push(val);
  try { await api.post('/api/found-via', { name: val }); } catch { /* already exists server-side */ }
  syncOptionUI();
}

async function deleteTypeOption(name) {
  const res = await api.del(`/api/types/${encodeURIComponent(name)}`);
  state.types = res.types;
  state.entries.forEach(e => { if (e.type === name) e.type = null; });
  if (state.filters.type === name) state.filters.type = '';
  syncOptionUI(name);
  renderBrowse();
}

async function renameTypeOption(oldName, newName) {
  const res = await api.put(`/api/types/${encodeURIComponent(oldName)}`, { newName });
  state.types = res.types;
  state.entries.forEach(e => { if (e.type === oldName) e.type = newName; });
  if (state.filters.type === oldName) state.filters.type = newName;
  Object.keys(combos).forEach(id => { if (combos[id].value === oldName) setCombo(id, newName); });
  syncOptionUI();
  renderBrowse();
}

async function deleteFoundViaOption(name) {
  const res = await api.del(`/api/found-via/${encodeURIComponent(name)}`);
  state.foundVia = res.foundVia;
  state.entries.forEach(e => { if (e.found_via === name) e.found_via = ''; });
  syncOptionUI(name);
}

async function renameFoundViaOption(oldName, newName) {
  const res = await api.put(`/api/found-via/${encodeURIComponent(oldName)}`, { newName });
  state.foundVia = res.foundVia;
  state.entries.forEach(e => { if (e.found_via === oldName) e.found_via = newName; });
  Object.keys(combos).forEach(id => { if (combos[id].value === oldName) setCombo(id, newName); });
  syncOptionUI();
}

function tagUsage(name) { return state.entries.filter(e => (e.style_tags || []).includes(name)).length; }

async function deleteTagOption(name) {
  const res = await api.del(`/api/tags/${encodeURIComponent(name)}`);
  state.tags = res.tags;
  state.entries.forEach(e => { e.style_tags = (e.style_tags || []).filter(t => t !== name); });
  state.filters.tags = state.filters.tags.filter(t => t !== name);
  [formSelectedTags, detailTags].forEach(arr => {
    const i = arr.indexOf(name);
    if (i !== -1) arr.splice(i, 1);
  });
  renderFormTagPills();
  renderDetailTagPills();
  renderTagList();
  renderBrowse();
}

async function renameTagOption(oldName, newName) {
  const res = await api.put(`/api/tags/${encodeURIComponent(oldName)}`, { newName });
  state.tags = res.tags;
  state.entries.forEach(e => { e.style_tags = (e.style_tags || []).map(t => t === oldName ? newName : t); });
  state.filters.tags = state.filters.tags.map(t => t === oldName ? newName : t);
  [formSelectedTags, detailTags].forEach(arr => {
    const i = arr.indexOf(oldName);
    if (i !== -1) arr[i] = newName;
  });
  renderFormTagPills();
  renderDetailTagPills();
  renderTagList();
  renderBrowse();
}

// ═══════════════════════════════════════════ NAVIGATION ══
function setupNav() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const v = el.dataset.view;
      navigate(v);
    });
  });
}

function navigate(view) {
  if (isFormDirty()) {
    confirm_('Discard unsaved changes to this entry?', () => { formSnapshot = null; doNavigate(view); }, 'Discard');
    return;
  }
  doNavigate(view);
}

function doNavigate(view) {
  state.view = view;
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  // Show target view
  const el = document.getElementById(`view-${view}`);
  if (el) el.style.display = 'block';
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  // Render
  if (view === 'browse') renderBrowse();
  if (view === 'boards') renderBoards();
  if (view === 'favorites') renderFavorites();
  if (view === 'add') openAddForm(null);
  if (view === 'settings') renderSettings();
}

// ═══════════════════════════════════════════ THEME ══
function setupTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem('omniview-theme') || 'dark';
  setTheme(saved);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.t));
  });
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('omniview-theme', t);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.t === t));
}

// ═══════════════════════════════════════════ SIDEBAR COLLAPSE ══
function setupSidebarCollapse() {
  const sidebar = document.querySelector('.sidebar');
  const btn = document.getElementById('sidebar-toggle');
  setSidebarCollapsed(localStorage.getItem('omniview-sidebar-collapsed') === '1');
  btn.addEventListener('click', () => setSidebarCollapsed(!sidebar.classList.contains('collapsed')));
}

function setSidebarCollapsed(collapsed) {
  const btn = document.getElementById('sidebar-toggle');
  document.querySelector('.sidebar').classList.toggle('collapsed', collapsed);
  localStorage.setItem('omniview-sidebar-collapsed', collapsed ? '1' : '0');
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

// ═══════════════════════════════════════════ KEYBOARD SHORTCUTS ══
function isOpen(overlayId) {
  const el = document.getElementById(overlayId);
  return el && el.style.display !== 'none';
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // Confirm can stack on top of the detail modal (e.g. delete-entry), so
      // it must be checked first — otherwise Escape closes the modal underneath.
      if (isOpen('confirm-overlay')) return document.getElementById('confirm-cancel').click();
      if (isOpen('detail-overlay')) return closeDetail();
      if (isOpen('board-picker-overlay')) return closeBoardPicker();
      return;
    }

    // Ctrl/Cmd+Enter saves whatever form or modal you're typing in.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const form = e.target.closest('form');
      if (form) { e.preventDefault(); form.requestSubmit(); return; }
      if (e.target.closest('#detail-overlay')) { e.preventDefault(); document.getElementById('detail-save').click(); }
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
    if (isOpen('detail-overlay') || isOpen('board-picker-overlay') || isOpen('confirm-overlay')) return;

    switch (e.key) {
      case '/': e.preventDefault(); navigate('browse'); document.getElementById('search-input').focus(); break;
      case 'n': case 'N': navigate('add'); break;
      case 'b': case 'B': navigate('browse'); break;
      case 'o': case 'O': navigate('boards'); break;
      case 'f': case 'F': navigate('favorites'); break;
      case 's': case 'S': navigate('settings'); break;
      case '?': navigate('shortcuts'); break;
    }
  });
}

// ═══════════════════════════════════════════ SEARCH ══
function setupSearch() {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  input.value = state.filters.q;
  clear.style.display = state.filters.q ? '' : 'none';
  input.addEventListener('input', () => {
    state.filters.q = input.value.trim();
    clear.style.display = state.filters.q ? '' : 'none';
    renderBrowse();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    state.filters.q = '';
    clear.style.display = 'none';
    renderBrowse();
  });
}

// ═══════════════════════════════════════════ FILTERS ══
// Search text, tag/type/board filters, favorite toggle, and sort order all
// persist across reloads, the same way theme and layout already do.
const FILTERS_KEY = 'omniview-filters';

function loadPersistedFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY));
    if (saved && saved.filters) Object.assign(state.filters, saved.filters);
    if (saved && saved.sort) state.sort = saved.sort;
  } catch { /* ignore malformed/missing storage */ }
}

function persistFilters() {
  localStorage.setItem(FILTERS_KEY, JSON.stringify({ filters: state.filters, sort: state.sort }));
}

function setupFilters() {
  document.getElementById('filter-fav').addEventListener('click', () => {
    state.filters.favorite = !state.filters.favorite;
    renderBrowse();
  });

  // Tag mode
  document.getElementById('tag-mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.tag-mode-btn');
    if (!btn) return;
    state.filters.tagMode = btn.dataset.mode;
    document.querySelectorAll('.tag-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.filters.tagMode));
    renderBrowse();
  });

  document.getElementById('filter-tags-clear').addEventListener('click', () => {
    state.filters.tags = [];
    renderBrowse();
  });

  document.getElementById('filter-clear').addEventListener('click', () => {
    state.filters = { ...state.filters, type: '', tags: [], board: '', favorite: false };
    renderBrowse();
  });

  // Close any open filter panel when clicking outside it
  document.addEventListener('click', e => {
    document.querySelectorAll('.filter-dropdown[open]').forEach(dd => {
      if (!dd.contains(e.target)) dd.open = false;
    });
  });
}

// A single-choice filter that reuses the Style Tags pill markup, so every pill
// in the bar has identical dimensions and states.
function renderSingleFilter(ddId, listId, labelId, allLabel, options, current, onPick) {
  const dd = document.getElementById(ddId);
  const list = document.getElementById(listId);
  const chosen = options.find(o => o.value === current);
  document.getElementById(labelId).textContent = chosen ? chosen.label : allLabel;
  dd.classList.toggle('active', !!chosen);

  list.innerHTML = '';
  [{ value: '', label: allLabel }, ...options].forEach(o => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'filter-option' + (o.value === current ? ' selected' : '');
    item.textContent = o.label;
    item.addEventListener('click', () => { dd.open = false; onPick(o.value); });
    list.appendChild(item);
  });
}

function renderTypeFilter() {
  renderSingleFilter(
    'filter-type-dd', 'filter-type-list', 'filter-type-label', 'All Types',
    [...state.types].sort((a, b) => a.localeCompare(b)).map(t => ({ value: t, label: t })),
    state.filters.type,
    v => { state.filters.type = v; renderBrowse(); }
  );
}

function renderTagFilters() {
  const wrap = document.getElementById('filter-tags');
  wrap.innerHTML = '';
  [...state.tags].sort((a, b) => a.localeCompare(b)).forEach(tag => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.filters.tags.includes(tag);
    box.addEventListener('change', () => {
      state.filters.tags = box.checked
        ? [...state.filters.tags, tag]
        : state.filters.tags.filter(t => t !== tag);
      renderBrowse();
    });
    label.appendChild(box);
    label.appendChild(document.createTextNode(tag));
    wrap.appendChild(label);
  });
  if (state.tags.length === 0) wrap.innerHTML = '<div class="filter-check-empty">No tags yet.</div>';

  const n = state.filters.tags.length;
  const count = document.getElementById('filter-tags-count');
  count.textContent = n;
  count.style.display = n ? '' : 'none';
  document.getElementById('filter-tags-clear').style.display = n ? '' : 'none';
  document.getElementById('filter-tags-dd').classList.toggle('active', n > 0);
  document.getElementById('tag-mode-toggle').style.display = n > 1 ? '' : 'none';
}

function renderBoardFilters() {
  const dd = document.getElementById('filter-boards-dd');
  dd.style.display = state.boards.length === 0 ? 'none' : '';
  renderSingleFilter(
    'filter-boards-dd', 'filter-boards-list', 'filter-boards-label', 'All Boards',
    state.boards.map(b => ({ value: b.id, label: b.name })),
    state.filters.board,
    v => { state.filters.board = v; renderBrowse(); }
  );
}

// ─── Sort ──────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
  { value: 'type', label: 'By Type' }
];

function sortEntries(entries) {
  const list = [...entries];
  const byNewest = (a, b) => new Date(b.date_added) - new Date(a.date_added);
  const titleOf = e => e.title || cleanUrl(e.url);
  switch (state.sort) {
    case 'oldest': return list.sort((a, b) => new Date(a.date_added) - new Date(b.date_added));
    case 'az': return list.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    case 'type': return list.sort((a, b) => (a.type || '').localeCompare(b.type || '') || byNewest(a, b));
    default: return list.sort(byNewest);
  }
}

function renderSortFilter() {
  const dd = document.getElementById('filter-sort-dd');
  const list = document.getElementById('filter-sort-list');
  const current = SORT_OPTIONS.find(o => o.value === state.sort) || SORT_OPTIONS[0];
  document.getElementById('filter-sort-label').textContent = `Sort: ${current.label}`;
  list.innerHTML = '';
  SORT_OPTIONS.forEach(o => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'filter-option' + (o.value === state.sort ? ' selected' : '');
    item.textContent = o.label;
    item.addEventListener('click', () => { dd.open = false; state.sort = o.value; renderBrowse(); });
    list.appendChild(item);
  });
}

// ═══════════════════════════════════════════ BROWSE ══
function applyFilters(entries) {
  let list = entries;
  const f = state.filters;
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      e.url.toLowerCase().includes(q) ||
      (e.note || '').toLowerCase().includes(q) ||
      (e.style_tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  if (f.type) list = list.filter(e => e.type === f.type);
  if (f.tags.length) {
    if (f.tagMode === 'all') {
      list = list.filter(e => f.tags.every(t => (e.style_tags || []).includes(t)));
    } else {
      list = list.filter(e => f.tags.some(t => (e.style_tags || []).includes(t)));
    }
  }
  if (f.board) list = list.filter(e => (e.boards || []).includes(f.board));
  if (f.favorite) list = list.filter(e => e.favorite);
  return list;
}

function renderBrowse() {
  const f = state.filters;
  renderTypeFilter();
  renderTagFilters();
  renderBoardFilters();
  renderSortFilter();
  document.getElementById('filter-fav').classList.toggle('active', f.favorite);
  document.getElementById('filter-clear').style.display =
    (f.type || f.tags.length || f.board || f.favorite) ? '' : 'none';

  const filtered = sortEntries(applyFilters(state.entries));
  const grid = document.getElementById('entry-grid');
  const list = document.getElementById('entry-list');
  const gallery = state.layout === 'gallery';

  if (gallery) renderGrid(grid, filtered, true);
  else renderList(list, filtered, true);

  grid.style.display = gallery && filtered.length ? '' : 'none';
  list.style.display = !gallery && filtered.length ? '' : 'none';
  document.getElementById('browse-empty').style.display = filtered.length === 0 ? '' : 'none';
  refreshStats();
  persistFilters();
}

// ═══════════════════════════════════════════ LAYOUT SWITCH ══
function setupLayoutSwitch() {
  document.getElementById('view-switch').addEventListener('click', e => {
    const btn = e.target.closest('.view-switch-btn');
    if (!btn || btn.dataset.layout === state.layout) return;
    state.layout = btn.dataset.layout;
    localStorage.setItem('omniview-layout', state.layout);
    syncLayoutButtons();
    renderBrowse();
  });
  syncLayoutButtons();
}

function syncLayoutButtons() {
  document.querySelectorAll('.view-switch-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.layout === state.layout));
}

function renderGrid(gridEl, entries, clickOpensDetail = true) {
  gridEl.innerHTML = '';
  entries.forEach(entry => {
    const card = createCard(entry, clickOpensDetail);
    gridEl.appendChild(card);
  });
}

function createCard(entry, clickOpensDetail) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.id = entry.id;
  if (state.selectedIds.has(entry.id)) card.classList.add('selected');

  const isMobile = entry.type === 'Mobile App';
  const thumb = document.createElement('div');
  thumb.className = 'thumb-wrap' + (isMobile ? ' mobile' : '');

  if (entry.screenshot) {
    const img = document.createElement('img');
    img.src = `/uploads/${entry.screenshot}`;
    img.alt = entry.url;
    img.loading = 'lazy';
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = `<div class="thumb-placeholder">${PLACEHOLDER_SVG}<span>No screenshot</span></div>`;
  }

  // Overlay: fav + check
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  const favBtn = document.createElement('button');
  favBtn.className = 'card-fav' + (entry.favorite ? ' is-fav' : '');
  favBtn.title = entry.favorite ? 'Unfavorite' : 'Favorite';
  favBtn.textContent = '♥';
  favBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await toggleFavorite(entry.id);
  });
  const openBtn = document.createElement('a');
  openBtn.className = 'card-open';
  openBtn.href = entry.url;
  openBtn.target = '_blank';
  openBtn.rel = 'noopener';
  openBtn.title = 'Open site';
  openBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 2H2v9h9V8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 1.5H11.5V5.5M11.5 1.5L6 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  openBtn.addEventListener('click', e => e.stopPropagation());
  overlay.append(openBtn, favBtn);
  thumb.appendChild(overlay);

  // Bulk check
  const check = document.createElement('div');
  check.className = 'card-check';
  check.textContent = '✓';
  thumb.appendChild(check);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';
  const urlEl = document.createElement('div');
  urlEl.className = 'card-url';
  urlEl.textContent = entry.title || cleanUrl(entry.url);
  urlEl.title = entry.url;
  body.appendChild(urlEl);

  if ((entry.style_tags || []).length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'card-tags';
    entry.style_tags.slice(0, 3).forEach(t => {
      const tag = document.createElement('span');
      tag.className = 'card-tag';
      tag.textContent = t;
      tagsEl.appendChild(tag);
    });
    if (entry.style_tags.length > 3) {
      const more = document.createElement('span');
      more.className = 'card-tag';
      more.textContent = `+${entry.style_tags.length - 3}`;
      tagsEl.appendChild(more);
    }
    body.appendChild(tagsEl);
  }

  card.appendChild(thumb);
  card.appendChild(body);

  card.addEventListener('click', e => {
    if (state.bulkMode) {
      toggleSelect(entry.id, card);
      return;
    }
    if (clickOpensDetail) openDetail(entry.id);
  });

  return card;
}

function cleanUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// ═══════════════════════════════════════════ LIST VIEW ══
function renderList(listEl, entries, clickOpensDetail = true) {
  listEl.innerHTML = '';
  entries.forEach(entry => listEl.appendChild(createRow(entry, clickOpensDetail)));
}

function createRow(entry, clickOpensDetail) {
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.dataset.id = entry.id;
  if (state.selectedIds.has(entry.id)) row.classList.add('selected');

  const check = document.createElement('div');
  check.className = 'row-check';
  check.textContent = '✓';

  const thumb = document.createElement('div');
  thumb.className = 'row-thumb';
  if (entry.screenshot) {
    const img = document.createElement('img');
    img.src = `/uploads/${entry.screenshot}`;
    img.alt = '';
    img.loading = 'lazy';
    thumb.appendChild(img);
  } else {
    thumb.classList.add('empty');
    thumb.innerHTML = PLACEHOLDER_SVG;
  }

  const main = document.createElement('div');
  main.className = 'row-main';
  const title = document.createElement('div');
  title.className = 'row-title';
  title.textContent = entry.title || cleanUrl(entry.url);
  const url = document.createElement('div');
  url.className = 'row-url';
  url.textContent = cleanUrl(entry.url);
  url.title = entry.url;
  main.append(title, url);

  const type = document.createElement('div');
  type.className = 'row-type';
  if (entry.type) {
    const badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = entry.type;
    type.appendChild(badge);
  }

  const tags = document.createElement('div');
  tags.className = 'row-tags';
  const list = entry.style_tags || [];
  list.slice(0, 3).forEach(t => {
    const s = document.createElement('span');
    s.className = 'card-tag';
    s.textContent = t;
    tags.appendChild(s);
  });
  if (list.length > 3) {
    const s = document.createElement('span');
    s.className = 'card-tag';
    s.textContent = `+${list.length - 3}`;
    tags.appendChild(s);
  }

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const fav = document.createElement('button');
  fav.className = 'card-fav' + (entry.favorite ? ' is-fav' : '');
  fav.textContent = '♥';
  fav.title = entry.favorite ? 'Unfavorite' : 'Favorite';
  fav.addEventListener('click', async e => { e.stopPropagation(); await toggleFavorite(entry.id); });
  const open = document.createElement('a');
  open.className = 'row-open';
  open.href = entry.url;
  open.target = '_blank';
  open.rel = 'noopener';
  open.title = 'Open source';
  open.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 2H2v9h9V8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 1.5H11.5V5.5M11.5 1.5L6 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  open.addEventListener('click', e => e.stopPropagation());
  actions.append(fav, open);

  row.append(check, thumb, main, type, tags, actions);

  row.addEventListener('click', () => {
    if (state.bulkMode) { toggleSelect(entry.id, row); return; }
    if (clickOpensDetail) openDetail(entry.id);
  });

  return row;
}

// ═══════════════════════════════════════════ BULK ══
// Bulk mode paints both layouts, so every entry point goes through here.
function setBulkMode(on) {
  state.bulkMode = on;
  state.selectedIds.clear();
  document.getElementById('bulk-toggle').classList.toggle('active', on);
  document.getElementById('bulk-bar').style.display = on ? '' : 'none';
  document.getElementById('entry-grid').classList.toggle('bulk-mode', on);
  document.getElementById('entry-list').classList.toggle('bulk-mode', on);
  updateBulkCount();
  renderBrowse();
}

function setupBulk() {
  document.getElementById('bulk-toggle').addEventListener('click', () => setBulkMode(!state.bulkMode));
  document.getElementById('bulk-cancel').addEventListener('click', () => setBulkMode(false));

  document.getElementById('bulk-apply-tag').addEventListener('click', async () => {
    const tag = document.getElementById('bulk-tag-select').value;
    if (!tag || state.selectedIds.size === 0) return;
    await api.post('/api/entries/bulk', { ids: [...state.selectedIds], action: 'tag', tag });
    state.entries = await api.get('/api/entries');
    state.selectedIds.clear();
    updateBulkCount();
    renderBrowse();
  });

  document.getElementById('bulk-delete').addEventListener('click', () => {
    if (state.selectedIds.size === 0) return;
    const ids = [...state.selectedIds];
    confirm_(`Delete ${ids.length} selected entries?`, () => {
      setBulkMode(false);
      deleteEntriesWithUndo(ids);
    });
  });
}

// Removes entries from view immediately and shows an "Undo" toast; the actual
// server delete (which also removes the screenshot file) only fires once the
// toast's 5s window elapses without Undo being clicked.
function deleteEntriesWithUndo(ids) {
  const removed = ids
    .map(id => ({ id, idx: state.entries.findIndex(e => e.id === id) }))
    .filter(r => r.idx !== -1)
    .map(r => ({ ...r, entry: state.entries[r.idx] }));
  if (removed.length === 0) return;

  [...removed].sort((a, b) => b.idx - a.idx).forEach(r => state.entries.splice(r.idx, 1));
  renderBrowse();
  if (state.view === 'favorites') renderFavorites();
  refreshStats();

  let undone = false;
  const timer = setTimeout(async () => {
    if (undone) return;
    try {
      await api.post('/api/entries/bulk', { ids, action: 'delete' });
    } catch {
      toastError('Failed to delete. Reloading entries.');
      state.entries = await api.get('/api/entries');
      renderBrowse();
      if (state.view === 'favorites') renderFavorites();
      refreshStats();
    }
  }, 5000);

  showToast(removed.length === 1 ? 'Entry deleted.' : `${removed.length} entries deleted.`, {
    duration: 5000,
    actionLabel: 'Undo',
    onAction: () => {
      undone = true;
      clearTimeout(timer);
      [...removed].sort((a, b) => a.idx - b.idx).forEach(r => state.entries.splice(r.idx, 0, r.entry));
      renderBrowse();
      if (state.view === 'favorites') renderFavorites();
      refreshStats();
    }
  });
}

function toggleSelect(id, card) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
    card.classList.remove('selected');
  } else {
    state.selectedIds.add(id);
    card.classList.add('selected');
  }
  updateBulkCount();
}

function updateBulkCount() {
  document.getElementById('bulk-count').textContent = `${state.selectedIds.size} selected`;
  // Populate tag dropdown
  const sel = document.getElementById('bulk-tag-select');
  sel.innerHTML = '<option value="">Add tag…</option>';
  [...state.tags].sort((a, b) => a.localeCompare(b)).forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
}

// ═══════════════════════════════════════════ FAVORITES ══
async function toggleFavorite(id) {
  const idx = state.entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  const updated = await api.put(`/api/entries/${id}`, { favorite: !state.entries[idx].favorite });
  state.entries[idx] = updated;
  renderBrowse();
  if (state.view === 'favorites') renderFavorites();
  refreshStats();
}

function renderFavorites() {
  const favs = state.entries.filter(e => e.favorite).sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  renderGrid(document.getElementById('fav-grid'), favs);
  document.getElementById('fav-empty').style.display = favs.length === 0 ? '' : 'none';
}

// ═══════════════════════════════════════════ BOARDS ══
function renderBoards() {
  // Reset board detail
  document.getElementById('boards-grid').style.display = '';
  document.getElementById('board-detail').style.display = 'none';
  document.getElementById('boards-title').textContent = 'Boards';
  document.getElementById('new-board-btn').style.display = '';

  const grid = document.getElementById('boards-grid');
  grid.innerHTML = '';
  const empty = document.getElementById('boards-empty');

  if (state.boards.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  state.boards.forEach(board => {
    const entries = state.entries.filter(e => (e.boards || []).includes(board.id));
    const card = document.createElement('div');
    card.className = 'board-card';
    card.appendChild(boardThumbCollage(entries));
    const meta = document.createElement('div');
    meta.className = 'board-card-meta';
    meta.innerHTML = `<div class="board-name">${escHtml(board.name)}</div><div class="board-count">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</div>`;
    card.appendChild(meta);
    card.addEventListener('click', () => openBoard(board));
    grid.appendChild(card);
  });

  // Update nav badge
  document.getElementById('nav-boards-count').textContent = state.boards.length || '';
}

// A 2x2 collage of up to 4 of the board's entry screenshots, so boards are
// recognizable at a glance instead of only by name.
function boardThumbCollage(entries) {
  const wrap = document.createElement('div');
  wrap.className = 'board-thumb-collage';
  for (let i = 0; i < 4; i++) {
    const cell = document.createElement('div');
    cell.className = 'board-thumb-cell';
    const entry = entries[i];
    if (entry && entry.screenshot) {
      const img = document.createElement('img');
      img.src = `/uploads/${entry.screenshot}`;
      img.alt = '';
      img.loading = 'lazy';
      cell.appendChild(img);
    } else {
      cell.classList.add('empty');
      cell.innerHTML = PLACEHOLDER_SVG;
    }
    wrap.appendChild(cell);
  }
  return wrap;
}

function openBoard(board) {
  state.currentBoard = board;
  document.getElementById('boards-grid').style.display = 'none';
  document.getElementById('boards-empty').style.display = 'none';
  document.getElementById('new-board-btn').style.display = 'none';
  document.getElementById('boards-title').textContent = board.name;
  document.getElementById('board-detail').style.display = '';

  document.getElementById('add-to-board-btn').onclick = () => openBoardPicker(board);

  document.getElementById('rename-board-btn').onclick = async () => {
    const name = prompt('New board name:', board.name);
    if (!name || name === board.name) return;
    const updated = await api.put(`/api/boards/${board.id}`, { name });
    const idx = state.boards.findIndex(b => b.id === board.id);
    state.boards[idx] = updated;
    document.getElementById('boards-title').textContent = updated.name;
    state.currentBoard = updated;
    updateFormBoardChips();
    renderBoardFilters();
  };

  document.getElementById('delete-board-btn').onclick = () => {
    confirm_(`Delete board "${board.name}"? Entries will not be deleted.`, async () => {
      await api.del(`/api/boards/${board.id}`);
      state.boards = state.boards.filter(b => b.id !== board.id);
      state.entries.forEach(e => { e.boards = (e.boards || []).filter(id => id !== board.id); });
      renderBoards();
      updateFormBoardChips();
      renderBoardFilters();
    });
  };

  const entries = state.entries.filter(e => (e.boards || []).includes(board.id));
  renderGrid(document.getElementById('board-entry-grid'), entries);
  document.getElementById('board-empty').style.display = entries.length === 0 ? '' : 'none';
}

// ── Board picker: add existing entries to the currently open board ──
function setupBoardPicker() {
  document.getElementById('board-picker-cancel').addEventListener('click', closeBoardPicker);
  document.getElementById('board-picker-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('board-picker-overlay')) closeBoardPicker();
  });

  document.getElementById('board-picker-add').addEventListener('click', async () => {
    const board = state.currentBoard;
    if (!board) return;
    const ids = [...document.querySelectorAll('#board-picker-list input:checked')].map(el => el.value);
    if (ids.length === 0) { closeBoardPicker(); return; }
    await api.post('/api/entries/bulk', { ids, action: 'addToBoard', boards: board.id });
    ids.forEach(id => {
      const entry = state.entries.find(e => e.id === id);
      if (entry && !(entry.boards || []).includes(board.id)) entry.boards.push(board.id);
    });
    closeBoardPicker();
    openBoard(board);
    renderBoardFilters();
  });
}

function openBoardPicker(board) {
  const list = document.getElementById('board-picker-list');
  list.innerHTML = '';
  const available = state.entries.filter(e => !(e.boards || []).includes(board.id));

  if (available.length === 0) {
    list.innerHTML = '<div class="board-picker-empty">Every entry is already on this board.</div>';
  } else {
    available.forEach(entry => {
      const card = document.createElement('label');
      card.className = 'picker-card';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = entry.id;
      box.addEventListener('change', () => card.classList.toggle('selected', box.checked));

      const thumb = document.createElement('div');
      thumb.className = 'picker-thumb';
      if (entry.screenshot) {
        const img = document.createElement('img');
        img.src = `/uploads/${entry.screenshot}`;
        img.alt = '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      } else {
        thumb.classList.add('empty');
        thumb.innerHTML = PLACEHOLDER_SVG;
      }

      // Title when there is one, otherwise the source URL.
      const name = document.createElement('div');
      name.className = 'picker-title';
      name.textContent = entry.title || cleanUrl(entry.url);
      name.title = entry.url;

      const tick = document.createElement('span');
      tick.className = 'picker-tick';
      tick.textContent = '✓';

      card.append(box, thumb, name, tick);
      list.appendChild(card);
    });
  }

  openModalOverlay('board-picker-overlay');
}

function closeBoardPicker() {
  closeModalOverlay('board-picker-overlay');
}

document.getElementById('board-back').addEventListener('click', () => {
  state.currentBoard = null;
  renderBoards();
});

document.getElementById('new-board-btn').addEventListener('click', async () => {
  const name = prompt('Board name:');
  if (!name) return;
  const board = await api.post('/api/boards', { name });
  state.boards.push(board);
  renderBoards();
  updateFormBoardChips();
  renderBoardFilters();
});

// ═══════════════════════════════════════════ ADD / EDIT FORM ══
let formSelectedTags = [];
let formSelectedBoards = new Set();
let formSnapshot = null;

// Captured right after the form is populated; compared against on every
// navigation attempt so edits aren't discarded without a prompt.
function captureFormSnapshot() {
  return JSON.stringify({
    title: document.getElementById('f-title').value,
    url: document.getElementById('f-url').value,
    type: comboValue('f-type'),
    color: comboValue('f-color'),
    foundVia: comboValue('f-found-via'),
    note: document.getElementById('f-note').value,
    favorite: document.getElementById('f-favorite').checked,
    tags: [...formSelectedTags],
    boards: [...formSelectedBoards],
    pendingScreenshot: !!state.pendingScreenshotFile,
    removeScreenshot: !!(state.editingEntry && state.editingEntry._removeScreenshot)
  });
}

function isFormDirty() {
  return state.view === 'add' && formSnapshot !== null && captureFormSnapshot() !== formSnapshot;
}

function openAddForm(entry) {
  document.getElementById('add-view-title').textContent = entry ? 'Edit Entry' : 'Add Entry';
  document.getElementById('form-submit').textContent = entry ? 'Save Changes' : 'Save Entry';
  state.editingEntry = entry;
  state.pendingScreenshotFile = null;
  if (entry) entry._removeScreenshot = false;

  // Reset form
  document.getElementById('f-title').value = entry ? (entry.title || '') : '';
  document.getElementById('f-url').value = entry ? entry.url : '';
  setCombo('f-type', entry ? (entry.type || '') : '');
  setCombo('f-color', entry ? (entry.color || '') : '');
  setCombo('f-found-via', entry ? (entry.found_via || '') : '');
  document.getElementById('f-note').value = entry ? (entry.note || '') : '';
  document.getElementById('f-favorite').checked = entry ? !!entry.favorite : false;
  document.getElementById('edit-entry-id').value = entry ? entry.id : '';
  document.getElementById('dupe-warning').style.display = 'none';

  // Mutate in place (not `formSelectedTags = [...]`) so the array reference
  // captured by setupTagInput's closures stays valid — see renderFormTagPills.
  formSelectedTags.length = 0;
  formSelectedTags.push(...(entry ? (entry.style_tags || []) : []));
  formSelectedBoards = new Set(entry ? (entry.boards || []) : []);

  renderFormTagPills();
  updateFormBoardChips();
  updateDropZoneForEdit(entry);

  formSnapshot = captureFormSnapshot();
}

function updateDropZoneForEdit(entry) {
  const inner = document.getElementById('drop-zone-inner');
  const preview = document.getElementById('drop-preview');
  const clearBtn = document.getElementById('drop-clear');

  if (entry && entry.screenshot) {
    inner.style.display = 'none';
    preview.src = `/uploads/${entry.screenshot}`;
    preview.style.display = '';
    clearBtn.style.display = '';
  } else {
    inner.style.display = '';
    preview.style.display = 'none';
    clearBtn.style.display = 'none';
  }
}

function setupAddForm() {
  // Drop zone
  const zone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('screenshot-file');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) setScreenshotPreview(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setScreenshotPreview(fileInput.files[0]);
  });

  document.getElementById('drop-clear').addEventListener('click', () => {
    state.pendingScreenshotFile = null;
    fileInput.value = '';
    document.getElementById('drop-zone-inner').style.display = '';
    document.getElementById('drop-preview').style.display = 'none';
    document.getElementById('drop-clear').style.display = 'none';
    // If editing, mark screenshot for removal
    if (state.editingEntry) state.editingEntry._removeScreenshot = true;
  });

  // URL blur: duplicate check
  document.getElementById('f-url').addEventListener('blur', async () => {
    const url = document.getElementById('f-url').value.trim();
    if (!url || (state.editingEntry && state.editingEntry.url === url)) {
      document.getElementById('dupe-warning').style.display = 'none';
      return;
    }
    const dupe = state.entries.find(e => e.url === url && e.id !== (state.editingEntry?.id));
    document.getElementById('dupe-warning').style.display = dupe ? '' : 'none';
  });

  // Tag search
  setupTagInput('tag-search', 'tag-dropdown', 'tag-pills', formSelectedTags, renderFormTagPills);

  // Form boards
  updateFormBoardChips();

  // Cancel
  document.getElementById('form-cancel').addEventListener('click', () => {
    formSnapshot = null;
    history.back();
    if (state.view === 'add') navigate('browse');
  });

  // Submit
  document.getElementById('entry-form').addEventListener('submit', async e => {
    e.preventDefault();
    const url = document.getElementById('f-url').value.trim();
    if (!url) return;

    const payload = {
      title: document.getElementById('f-title').value.trim(),
      url,
      type: comboValue('f-type') || null,
      color: comboValue('f-color') || null,
      found_via: comboValue('f-found-via'),
      note: document.getElementById('f-note').value.trim(),
      favorite: document.getElementById('f-favorite').checked,
      style_tags: formSelectedTags,
      boards: [...formSelectedBoards]
    };
    if (state.editingEntry && state.editingEntry._removeScreenshot) payload.removeScreenshot = true;

    let entry;
    if (state.editingEntry) {
      entry = await api.put(`/api/entries/${state.editingEntry.id}`, payload);
      const idx = state.entries.findIndex(e => e.id === entry.id);
      if (idx !== -1) state.entries[idx] = entry;
    } else {
      const res = await api.post('/api/entries', payload);
      entry = res.entry;
      state.entries.unshift(entry);
    }

    // Upload screenshot if pending
    if (state.pendingScreenshotFile) {
      const { screenshot } = await api.uploadScreenshot(entry.id, state.pendingScreenshotFile);
      const idx = state.entries.findIndex(e => e.id === entry.id);
      if (idx !== -1) state.entries[idx].screenshot = screenshot;
    }

    const wasEdit = !!state.editingEntry;
    state.editingEntry = null;
    state.pendingScreenshotFile = null;
    formSnapshot = null;
    navigate('browse');
    refreshStats();
    toastSuccess(wasEdit ? 'Entry updated.' : 'Entry added.');
  });
}

function setScreenshotPreview(file) {
  state.pendingScreenshotFile = file;
  if (state.editingEntry) state.editingEntry._removeScreenshot = false;
  const url = URL.createObjectURL(file);
  document.getElementById('drop-zone-inner').style.display = 'none';
  const preview = document.getElementById('drop-preview');
  preview.src = url;
  preview.style.display = '';
  document.getElementById('drop-clear').style.display = '';
}

function renderFormTagPills() {
  renderTagPills(document.getElementById('tag-pills'), formSelectedTags, tag => {
    const i = formSelectedTags.indexOf(tag);
    if (i !== -1) formSelectedTags.splice(i, 1);
    renderFormTagPills();
  });
}

function renderTagPills(container, tags, onRemove) {
  container.innerHTML = '';
  tags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escHtml(tag)}<button type="button" aria-label="Remove ${tag}">✕</button>`;
    pill.querySelector('button').addEventListener('click', () => onRemove(tag));
    container.appendChild(pill);
  });
}

function updateFormBoardChips() {
  const wrap = document.getElementById('form-boards');
  wrap.innerHTML = '';
  if (state.boards.length === 0) {
    wrap.innerHTML = '<span style="font-size:.75rem;color:var(--text-3)">No boards yet — create one in the Boards view.</span>';
    return;
  }
  state.boards.forEach(b => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'board-chip-toggle' + (formSelectedBoards.has(b.id) ? ' selected' : '');
    chip.textContent = b.name;
    chip.addEventListener('click', () => {
      if (formSelectedBoards.has(b.id)) formSelectedBoards.delete(b.id);
      else formSelectedBoards.add(b.id);
      chip.classList.toggle('selected', formSelectedBoards.has(b.id));
    });
    wrap.appendChild(chip);
  });
}

// ═══════════════════════════════════════════ TAG INPUT WIDGET ══
function setupTagInput(inputId, dropdownId, pillsId, tagsArr, onUpdate) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  input.addEventListener('input', () => renderTagDropdown(input, dropdown, tagsArr, onUpdate));
  input.addEventListener('focus', () => renderTagDropdown(input, dropdown, tagsArr, onUpdate));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (val && !tagsArr.includes(val)) {
        tagsArr.push(val);
        // Add new tag globally if not exists
        if (!state.tags.includes(val)) {
          state.tags.push(val);
          api.post('/api/tags', { name: val }).catch(() => {});
        }
        input.value = '';
        dropdown.style.display = 'none';
        onUpdate();
      }
    }
    if (e.key === 'Escape') { dropdown.style.display = 'none'; }
  });
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}

function renderTagDropdown(input, dropdown, tagsArr, onUpdate) {
  const q = input.value.toLowerCase();
  const available = state.tags
    .filter(t => !tagsArr.includes(t) && t.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b));
  dropdown.innerHTML = '';

  // "+ Add New" is always pinned first; typed text (if any) is offered as the default name.
  const addNew = document.createElement('div');
  addNew.className = 'tag-dropdown-item create';
  addNew.textContent = '+ Add New';
  addNew.addEventListener('mousedown', e => {
    e.preventDefault();
    const val = (prompt('New style tag name:', input.value.trim()) || '').trim();
    if (val && !tagsArr.includes(val)) {
      tagsArr.push(val);
      if (!state.tags.includes(val)) {
        state.tags.push(val);
        api.post('/api/tags', { name: val }).catch(() => {});
      }
    }
    input.value = '';
    dropdown.style.display = 'none';
    onUpdate();
  });
  dropdown.appendChild(addNew);

  available.forEach(tag => {
    const item = document.createElement('div');
    item.className = 'tag-dropdown-item';
    const label = document.createElement('span');
    label.textContent = tag;
    item.appendChild(label);
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      tagsArr.push(tag);
      input.value = '';
      dropdown.style.display = 'none';
      onUpdate();
    });

    const del = optionDeleteBtn(tag, tagUsage(tag), deleteTagOption, () => { dropdown.style.display = 'none'; });
    // The row itself selects on mousedown, so the ✕ must swallow that too.
    del.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    item.appendChild(del);

    dropdown.appendChild(item);
  });

  dropdown.style.display = '';
}

// ═══════════════════════════════════════════ DETAIL MODAL ══
let detailTags = [];
let detailBoards = new Set();

async function applyDetailScreenshot(file) {
  if (!state.detailEntry) return;
  const { screenshot } = await api.uploadScreenshot(state.detailEntry.id, file);
  const idx = state.entries.findIndex(en => en.id === state.detailEntry.id);
  if (idx !== -1) state.entries[idx].screenshot = screenshot;
  state.detailEntry.screenshot = screenshot;
  document.getElementById('detail-screenshot').src = `/uploads/${screenshot}?t=${Date.now()}`;
  document.getElementById('detail-screenshot').style.display = '';
  document.getElementById('detail-no-screenshot').style.display = 'none';
}

function setupDetailModal() {
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('detail-overlay')) closeDetail();
  });

  document.getElementById('detail-fav').addEventListener('click', async () => {
    if (!state.detailEntry) return;
    await toggleFavorite(state.detailEntry.id);
    state.detailEntry = state.entries.find(e => e.id === state.detailEntry.id);
    document.getElementById('detail-fav').classList.toggle('is-fav', state.detailEntry?.favorite);
  });

  // Screenshot upload in detail
  document.getElementById('detail-screenshot-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) await applyDetailScreenshot(file);
  });

  // Tag input in detail
  setupTagInput('detail-tag-search', 'detail-tag-dropdown', 'detail-tag-pills', detailTags, renderDetailTagPills);

  document.getElementById('detail-save').addEventListener('click', async () => {
    if (!state.detailEntry) return;
    const payload = {
      title: document.getElementById('detail-title').value.trim(),
      url: state.detailEntry.url,
      type: comboValue('detail-type') || null,
      color: comboValue('detail-color') || null,
      found_via: comboValue('detail-found-via'),
      note: document.getElementById('detail-note').value.trim(),
      favorite: state.detailEntry.favorite,
      style_tags: detailTags,
      boards: [...detailBoards]
    };
    const updated = await api.put(`/api/entries/${state.detailEntry.id}`, payload);
    const idx = state.entries.findIndex(e => e.id === updated.id);
    if (idx !== -1) state.entries[idx] = updated;
    state.detailEntry = updated;
    closeDetail();
    renderBrowse();
    toastSuccess('Entry updated.');
  });

  document.getElementById('detail-delete').addEventListener('click', () => {
    if (!state.detailEntry) return;
    const entry = state.detailEntry;
    confirm_(`Delete this entry?`, () => {
      closeDetail();
      deleteEntriesWithUndo([entry.id]);
    });
  });
}

async function openDetail(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  state.detailEntry = entry;
  // Mutate in place — see the comment in openAddForm for why reassigning breaks the tag dropdown.
  detailTags.length = 0;
  detailTags.push(...(entry.style_tags || []));
  detailBoards = new Set(entry.boards || []);

  document.getElementById('detail-url').href = entry.url;
  document.getElementById('detail-url').textContent = entry.url;
  document.getElementById('detail-fav').classList.toggle('is-fav', !!entry.favorite);
  document.getElementById('detail-title').value = entry.title || '';
  setCombo('detail-type', entry.type || '');
  setCombo('detail-color', entry.color || '');
  setCombo('detail-found-via', entry.found_via || '');
  document.getElementById('detail-note').value = entry.note || '';
  document.getElementById('detail-date').textContent = new Date(entry.date_added).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  if (entry.screenshot) {
    document.getElementById('detail-screenshot').src = `/uploads/${entry.screenshot}`;
    document.getElementById('detail-screenshot').style.display = '';
    document.getElementById('detail-no-screenshot').style.display = 'none';
  } else {
    document.getElementById('detail-screenshot').style.display = 'none';
    document.getElementById('detail-no-screenshot').style.display = '';
  }

  renderDetailTagPills();
  renderDetailBoardChips();

  openModalOverlay('detail-overlay');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  closeModalOverlay('detail-overlay');
  document.body.style.overflow = '';
  state.detailEntry = null;
}

function renderDetailTagPills() {
  renderTagPills(document.getElementById('detail-tag-pills'), detailTags, tag => {
    const i = detailTags.indexOf(tag);
    if (i !== -1) detailTags.splice(i, 1);
    renderDetailTagPills();
  });
}

function renderDetailBoardChips() {
  const wrap = document.getElementById('detail-boards');
  wrap.innerHTML = '';
  if (state.boards.length === 0) {
    wrap.innerHTML = '<span style="font-size:.75rem;color:var(--text-3)">No boards yet.</span>';
    return;
  }
  state.boards.forEach(b => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'board-chip-toggle' + (detailBoards.has(b.id) ? ' selected' : '');
    chip.textContent = b.name;
    chip.addEventListener('click', () => {
      if (detailBoards.has(b.id)) detailBoards.delete(b.id);
      else detailBoards.add(b.id);
      chip.classList.toggle('selected', detailBoards.has(b.id));
    });
    wrap.appendChild(chip);
  });
}

// ═══════════════════════════════════════════ CONFIRM MODAL ══
let confirmCallback = null;

function setupConfirmModal() {
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    closeModalOverlay('confirm-overlay');
    confirmCallback = null;
  });
  document.getElementById('confirm-ok').addEventListener('click', () => {
    closeModalOverlay('confirm-overlay');
    if (confirmCallback) { confirmCallback(); confirmCallback = null; }
  });
}

function confirm_(msg, cb, okLabel = 'Delete') {
  document.getElementById('confirm-body').textContent = msg;
  document.getElementById('confirm-ok').textContent = okLabel;
  openModalOverlay('confirm-overlay');
  confirmCallback = cb;
}

// ═══════════════════════════════════════════ TOAST ══
function showToast(message, opts = {}) {
  const { type = 'info', duration = 3500, actionLabel, onAction } = opts;
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;
  toast.appendChild(msg);

  const dismiss = () => {
    clearTimeout(timer);
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 160);
  };

  if (actionLabel) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => { onAction && onAction(); dismiss(); });
    toast.appendChild(action);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  close.addEventListener('click', dismiss);
  toast.appendChild(close);

  container.appendChild(toast);
  const timer = setTimeout(dismiss, duration);
}

function toastSuccess(message) { showToast(message, { type: 'success' }); }
function toastError(message) { showToast(message, { type: 'error', duration: 5000 }); }

// ═══════════════════════════════════════════ MODAL A11Y (focus trap + return) ══
// Tracks nested overlays (e.g. the confirm modal opening on top of the detail
// modal) so closing the inner one restores focus to the outer one, not the page.
const modalStack = [];

function focusableIn(container) {
  return [...container.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
}

function openModalOverlay(overlayId) {
  const overlay = document.getElementById(overlayId);
  const returnFocusEl = document.activeElement;
  overlay.style.display = '';
  const modal = overlay.querySelector('.modal');
  const focusable = focusableIn(modal);
  (focusable[0] || modal).focus();

  const keydownHandler = e => {
    if (e.key !== 'Tab') return;
    const items = focusableIn(modal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  overlay.addEventListener('keydown', keydownHandler);
  modalStack.push({ overlayId, overlay, keydownHandler, returnFocusEl });
}

function closeModalOverlay(overlayId) {
  const i = modalStack.findIndex(m => m.overlayId === overlayId);
  if (i === -1) return;
  const [m] = modalStack.splice(i, 1);
  m.overlay.style.display = 'none';
  m.overlay.removeEventListener('keydown', m.keydownHandler);
  if (m.returnFocusEl && m.returnFocusEl.isConnected) m.returnFocusEl.focus();
}

// ═══════════════════════════════════════════ SETTINGS ══
function setupSettings() {
  document.getElementById('add-tag-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-tag-input');
    const name = input.value.trim();
    if (!name) return;
    try {
      const res = await api.post('/api/tags', { name });
      state.tags = res.tags;
      input.value = '';
      renderTagList();
      renderTagFilters();
    } catch { toastError('Tag already exists.'); }
  });
  document.getElementById('new-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-tag-btn').click();
  });

  setupOptionAdder('new-type-input', 'add-type-btn', () => state.types, ensureType, renderTypeList);
  setupOptionAdder('new-found-via-input', 'add-found-via-btn', () => state.foundVia, ensureFoundVia, renderFoundViaList);

  document.getElementById('reset-btn').addEventListener('click', () => {
    confirm_('Factory reset? ALL entries, boards, and tags will be permanently deleted. This cannot be undone.', async () => {
      await api.post('/api/reset', {});
      await loadAll();
      renderBrowse();
      renderSettings();
      refreshStats();
    });
  });
}

function renderSettings() {
  renderTagList();
  renderTypeList();
  renderFoundViaList();
  // Sync theme buttons
  const t = document.documentElement.dataset.theme;
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.t === t));
}

function renderTagList() {
  renderManagedList('tag-list', 'tag-count', state.tags, {
    usage: tagUsage,
    onRename: renameTagOption,
    onDelete: deleteTagOption
  });
}

function setupOptionAdder(inputId, buttonId, getOptions, ensureFn, onAdded) {
  const input = document.getElementById(inputId);
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    if (getOptions().some(o => o.toLowerCase() === name.toLowerCase())) { toastError('That option already exists.'); return; }
    await ensureFn(name);
    input.value = '';
    onAdded();
  };
  document.getElementById(buttonId).addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}

// Rename + delete manager list, shared by all three Settings sections.
function renderManagedList(listId, countId, items, opts) {
  document.getElementById(countId).textContent = items.length;
  const list = document.getElementById(listId);
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<div class="tag-list-empty">None yet.</div>';
    return;
  }
  [...items].sort((a, b) => a.localeCompare(b)).forEach(name => {
    const item = document.createElement('div');
    item.className = 'tag-list-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    item.appendChild(nameSpan);

    const used = opts.usage(name);
    if (used) {
      const hint = document.createElement('small');
      hint.className = 'tag-list-use';
      hint.textContent = `${used} ${used === 1 ? 'entry' : 'entries'}`;
      item.appendChild(hint);
    }

    const actions = document.createElement('div');
    actions.className = 'tag-list-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'tag-action-btn';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      nameSpan.style.display = 'none';
      const inp = document.createElement('input');
      inp.value = name;
      item.insertBefore(inp, actions);
      inp.focus();
      inp.select();
      // Enter and blur both commit, so a `done` latch keeps the rename from
      // firing twice when Enter moves focus away.
      let done = false;
      const finish = async commit => {
        if (done) return;
        done = true;
        const newName = inp.value.trim();
        inp.remove();
        nameSpan.style.display = '';
        if (commit && newName && newName !== name) await opts.onRename(name, newName);
      };
      inp.addEventListener('blur', () => finish(true));
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'tag-action-btn del';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => confirmOptionDelete(name, used, () => opts.onDelete(name)));

    actions.append(renameBtn, delBtn);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function renderTypeList() {
  renderManagedList('type-list', 'type-count', state.types, {
    usage: COMBO_KINDS.type.usage,
    onRename: renameTypeOption,
    onDelete: deleteTypeOption
  });
}

function renderFoundViaList() {
  renderManagedList('found-via-list', 'found-via-count', state.foundVia, {
    usage: COMBO_KINDS.foundVia.usage,
    onRename: renameFoundViaOption,
    onDelete: deleteFoundViaOption
  });
}

// ═══════════════════════════════════════════ STATS ══
async function refreshStats() {
  try {
    const stats = await api.get('/api/stats');
    document.getElementById('stats-line').textContent = `${stats.entries} entries`;
    document.getElementById('nav-fav-count').textContent = stats.favorites || '';
    document.getElementById('nav-boards-count').textContent = stats.boards || '';
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════ UTILS ══
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════ BOOT ══
document.addEventListener('DOMContentLoaded', init);
