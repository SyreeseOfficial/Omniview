// Browse view: search, filters, sort, the gallery/masonry/list renderers, bulk
// actions, favorites, and the sidebar counters.

import {
  state, COLORS, PLACEHOLDER_SVG, OPEN_ICON, byName, cleanUrl, titleOf, safeHref, thumbImg, faviconImg, colorName
} from './state.js';
import { api } from './api.js';
import { confirm_, toastSuccess, toastError, showToast } from './modals.js';
import { openDetail } from './entry.js';
import { removeEntryFromBoard } from './boards.js';

const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════ RECENTLY VIEWED ══
const RECENT_KEY = 'omniview-recent';

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}

export function recordRecent(id) {
  const ids = [id, ...readRecent().filter(x => x !== id)].slice(0, 12);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}

// ═══════════════════════════════════════════ SEARCH ══
export function setupSearch() {
  const input = $('search-input');
  const clear = $('search-clear');
  input.value = state.filters.q;
  clear.style.display = state.filters.q ? '' : 'none';

  // Rebuilding the grid on every keystroke is wasteful, so typing is debounced.
  let timer;
  input.addEventListener('input', () => {
    clear.style.display = input.value.trim() ? '' : 'none';
    clearTimeout(timer);
    timer = setTimeout(() => { state.filters.q = input.value.trim(); renderBrowse(); }, 150);
  });
  clear.addEventListener('click', () => {
    clearTimeout(timer);
    input.value = '';
    state.filters.q = '';
    clear.style.display = 'none';
    renderBrowse();
  });
}

// ═══════════════════════════════════════════ FILTERS ══
// Search text, tag/type/board/color filters, favorite toggle, and sort order all
// persist across reloads, the same way theme and layout already do.
const FILTERS_KEY = 'omniview-filters';

export function loadPersistedFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY));
    if (saved && saved.filters) Object.assign(state.filters, saved.filters);
    if (saved && saved.sort) state.sort = saved.sort;
  } catch { /* ignore malformed/missing storage */ }
}

function persistFilters() {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify({ filters: state.filters, sort: state.sort })); } catch { /* storage unavailable */ }
}

export function setupFilters() {
  $('filter-fav').addEventListener('click', () => {
    state.filters.favorite = !state.filters.favorite;
    renderBrowse();
  });

  $('filter-recent').addEventListener('click', () => {
    state.filters.recent = !state.filters.recent;
    renderBrowse();
  });

  // Tag mode
  $('tag-mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.tag-mode-btn');
    if (!btn) return;
    state.filters.tagMode = btn.dataset.mode;
    document.querySelectorAll('.tag-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.filters.tagMode));
    renderBrowse();
  });

  $('filter-tags-clear').addEventListener('click', () => {
    state.filters.tags = [];
    renderBrowse();
  });

  $('filter-clear').addEventListener('click', () => {
    state.filters = { ...state.filters, type: '', tags: [], board: '', color: '', favorite: false, recent: false };
    renderBrowse();
  });

  $('random-btn').addEventListener('click', () => {
    const pool = sortEntries(applyFilters(state.entries));
    if (!pool.length) { showToast('Nothing to pick from.'); return; }
    openDetail(pool[Math.floor(Math.random() * pool.length)].id);
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
  const dd = $(ddId);
  const list = $(listId);
  const chosen = options.find(o => o.value === current);
  $(labelId).textContent = chosen ? chosen.label : allLabel;
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
    [...state.types].sort(byName).map(t => ({ value: t, label: t })),
    state.filters.type,
    v => { state.filters.type = v; renderBrowse(); }
  );
}

function renderTagFilters() {
  const wrap = $('filter-tags');
  wrap.innerHTML = '';
  [...state.tags].sort(byName).forEach(tag => {
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
  const count = $('filter-tags-count');
  count.textContent = n;
  count.style.display = n ? '' : 'none';
  $('filter-tags-clear').style.display = n ? '' : 'none';
  $('filter-tags-dd').classList.toggle('active', n > 0);
  $('tag-mode-toggle').style.display = n > 1 ? '' : 'none';
}

export function renderBoardFilters() {
  $('filter-boards-dd').style.display = state.boards.length === 0 ? 'none' : '';
  renderSingleFilter(
    'filter-boards-dd', 'filter-boards-list', 'filter-boards-label', 'All Boards',
    state.boards.map(b => ({ value: b.id, label: b.name })),
    state.filters.board,
    v => { state.filters.board = v; renderBrowse(); }
  );
}

// Swatch grid: an entry matches a color when its Color field is that name, or
// one of its three dominant palette colors falls in that name's bucket.
function renderColorFilter() {
  const current = state.filters.color;
  $('filter-color-dd').classList.toggle('active', !!current);
  $('filter-color-label').textContent = current || 'All Colors';
  const list = $('filter-color-list');
  list.innerHTML = '';
  Object.entries(COLORS).forEach(([name, css]) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch' + (name === current ? ' selected' : '');
    sw.style.background = css;
    sw.title = name;
    sw.setAttribute('aria-label', name);
    sw.setAttribute('aria-pressed', String(name === current));
    sw.addEventListener('click', () => {
      $('filter-color-dd').open = false;
      state.filters.color = name === current ? '' : name;
      renderBrowse();
    });
    list.appendChild(sw);
  });
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
  switch (state.sort) {
    case 'oldest': return list.sort((a, b) => new Date(a.date_added) - new Date(b.date_added));
    case 'az': return list.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    case 'type': return list.sort((a, b) => (a.type || '').localeCompare(b.type || '') || byNewest(a, b));
    default: return list.sort(byNewest);
  }
}

function renderSortFilter() {
  const dd = $('filter-sort-dd');
  const list = $('filter-sort-list');
  const current = SORT_OPTIONS.find(o => o.value === state.sort) || SORT_OPTIONS[0];
  $('filter-sort-label').textContent = `Sort: ${current.label}`;
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
// The browser holds the whole library, so filtering lives here and only here.
function applyFilters(entries) {
  let list = entries;
  const f = state.filters;
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.url.toLowerCase().includes(q) ||
      e.note.toLowerCase().includes(q) ||
      e.style_tags.some(t => t.toLowerCase().includes(q))
    );
  }
  if (f.type) list = list.filter(e => e.type === f.type);
  if (f.tags.length) {
    list = f.tagMode === 'all'
      ? list.filter(e => f.tags.every(t => e.style_tags.includes(t)))
      : list.filter(e => f.tags.some(t => e.style_tags.includes(t)));
  }
  if (f.board) list = list.filter(e => e.boards.includes(f.board));
  if (f.color) list = list.filter(e => e.color === f.color || e.palette.slice(0, 3).some(h => colorName(h) === f.color));
  if (f.favorite) list = list.filter(e => e.favorite);
  if (f.recent) {
    const recent = readRecent();
    list = list.filter(e => recent.includes(e.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
  }
  return list;
}

export function renderBrowse() {
  const f = state.filters;
  renderTypeFilter();
  renderTagFilters();
  renderBoardFilters();
  renderColorFilter();
  renderSortFilter();
  $('filter-fav').classList.toggle('active', f.favorite);
  $('filter-fav').setAttribute('aria-pressed', String(f.favorite));
  $('filter-recent').classList.toggle('active', f.recent);
  $('filter-recent').setAttribute('aria-pressed', String(f.recent));
  $('filter-clear').style.display =
    (f.type || f.tags.length || f.board || f.color || f.favorite || f.recent) ? '' : 'none';

  const matched = applyFilters(state.entries);
  const filtered = f.recent ? matched : sortEntries(matched); // "recent" keeps most-recently-viewed first
  if (state.view === 'browse') state.navIds = filtered.map(e => e.id);

  const grid = $('entry-grid');
  const list = $('entry-list');
  const asList = state.layout === 'list';

  if (asList) renderList(list, filtered, true);
  else renderGrid(grid, filtered, true);
  grid.classList.toggle('masonry', state.layout === 'masonry');

  grid.style.display = !asList && filtered.length ? '' : 'none';
  list.style.display = asList && filtered.length ? '' : 'none';
  $('browse-empty').style.display = filtered.length === 0 ? '' : 'none';
  $('browse-onboarding').style.display = state.entries.length === 0 ? '' : 'none';
  $('browse-no-match').style.display = state.entries.length === 0 ? 'none' : '';
  $('result-count').textContent = `${filtered.length} of ${state.entries.length}`;
  updateStats();
  persistFilters();
}

// Sidebar counters, derived from what's already loaded.
export function updateStats() {
  $('stats-line').textContent = `${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'}`;
  $('nav-fav-count').textContent = state.entries.filter(e => e.favorite).length || '';
  $('nav-boards-count').textContent = state.boards.length || '';
}

// ═══════════════════════════════════════════ LAYOUT SWITCH ══
export function setupLayoutSwitch() {
  $('view-switch').addEventListener('click', e => {
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
  document.querySelectorAll('.view-switch-btn').forEach(b => {
    const on = b.dataset.layout === state.layout;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

export function renderGrid(gridEl, entries, clickOpensDetail = true, boardId = null) {
  gridEl.innerHTML = '';
  entries.forEach(entry => gridEl.appendChild(createCard(entry, clickOpensDetail, boardId)));
}

// Small round action button used on card overlays and list rows.
function iconButton(tag, className, label) {
  const el = document.createElement(tag);
  el.className = className;
  el.title = label;
  el.setAttribute('aria-label', label);
  if (tag === 'button') el.type = 'button';
  return el;
}

function favButton(entry) {
  const btn = iconButton('button', 'card-fav' + (entry.favorite ? ' is-fav' : ''), entry.favorite ? 'Unfavorite' : 'Favorite');
  btn.setAttribute('aria-pressed', String(!!entry.favorite));
  btn.textContent = '♥';
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    await toggleFavorite(entry.id);
  });
  return btn;
}

function openLink(entry, className, label) {
  const href = safeHref(entry.url);
  if (!href) return null;
  const a = iconButton('a', className, label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML = OPEN_ICON;
  a.addEventListener('click', e => e.stopPropagation());
  return a;
}

// Click handling shared by cards and rows: bulk mode selects (shift = range), otherwise open the detail modal.
function onItemClick(e, el, entry, clickOpensDetail) {
  if (state.bulkMode) {
    if (e.shiftKey && state.selectAnchorId) selectRange(state.selectAnchorId, entry.id, el.parentElement);
    else toggleSelect(entry.id, el);
    state.selectAnchorId = entry.id;
    return;
  }
  if (clickOpensDetail) openDetail(entry.id);
}

function createCard(entry, clickOpensDetail, boardId = null) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.id = entry.id;
  if (state.selectedIds.has(entry.id)) card.classList.add('selected');

  const isMobile = entry.type === 'Mobile App';
  const thumb = document.createElement('div');
  thumb.className = 'thumb-wrap' + (isMobile ? ' mobile' : '');

  if (entry.screenshot) {
    thumb.appendChild(thumbImg(entry.screenshot, titleOf(entry)));
  } else {
    thumb.innerHTML = `<div class="thumb-placeholder">${PLACEHOLDER_SVG}<span>No screenshot</span></div>`;
  }

  // Overlay: open + fav (+ remove-from-board)
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  const open = openLink(entry, 'card-open', 'Open site');
  if (open) overlay.appendChild(open);
  overlay.appendChild(favButton(entry));

  if (boardId) {
    const removeBtn = iconButton('button', 'card-remove-board', 'Remove from board');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await removeEntryFromBoard(entry.id, boardId);
    });
    overlay.appendChild(removeBtn);

    // Drag onto another board's drop target (see boards.js)
    card.draggable = true;
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', entry.id);
      e.dataTransfer.effectAllowed = 'copyMove';
    });
  }
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
  if (entry.favicon) urlEl.appendChild(faviconImg(entry.favicon));
  urlEl.append(titleOf(entry));
  urlEl.title = entry.url;
  body.appendChild(urlEl);

  if (entry.style_tags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'card-tags';
    appendTagChips(tagsEl, entry.style_tags);
    body.appendChild(tagsEl);
  }

  card.appendChild(thumb);
  card.appendChild(body);
  card.addEventListener('click', e => onItemClick(e, card, entry, clickOpensDetail));
  return card;
}

// First three tags, then a "+N" chip.
function appendTagChips(container, tags) {
  tags.slice(0, 3).forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'card-tag';
    chip.textContent = t;
    container.appendChild(chip);
  });
  if (tags.length > 3) {
    const more = document.createElement('span');
    more.className = 'card-tag';
    more.textContent = `+${tags.length - 3}`;
    container.appendChild(more);
  }
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
    thumb.appendChild(thumbImg(entry.screenshot));
  } else {
    thumb.classList.add('empty');
    thumb.innerHTML = PLACEHOLDER_SVG;
  }

  const main = document.createElement('div');
  main.className = 'row-main';
  const title = document.createElement('div');
  title.className = 'row-title';
  if (entry.favicon) title.appendChild(faviconImg(entry.favicon));
  title.append(titleOf(entry));
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
  appendTagChips(tags, entry.style_tags);

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.appendChild(favButton(entry));
  const open = openLink(entry, 'row-open', 'Open source');
  if (open) actions.appendChild(open);

  row.append(check, thumb, main, type, tags, actions);
  row.addEventListener('click', e => onItemClick(e, row, entry, clickOpensDetail));
  return row;
}

// ═══════════════════════════════════════════ BULK ══
// Bulk mode paints both layouts, so every entry point goes through here.
function setBulkMode(on) {
  state.bulkMode = on;
  state.selectedIds.clear();
  state.selectAnchorId = null;
  $('bulk-toggle').classList.toggle('active', on);
  $('bulk-toggle').setAttribute('aria-pressed', String(on));
  $('bulk-bar').style.display = on ? '' : 'none';
  $('entry-grid').classList.toggle('bulk-mode', on);
  $('entry-list').classList.toggle('bulk-mode', on);
  $('bulk-action').value = '';
  fillBulkValue();
  updateBulkCount();
  renderBrowse();
}

// Which actions need a second dropdown, and what it lists.
const NO_TYPE = '__none__';
const BULK_VALUES = {
  tag: () => state.tags.map(t => ({ value: t, label: t })),
  untag: () => state.tags.map(t => ({ value: t, label: t })),
  setType: () => [{ value: NO_TYPE, label: '— None —' }, ...state.types.map(t => ({ value: t, label: t }))],
  addToBoard: () => state.boards.map(b => ({ value: b.id, label: b.name })),
  removeFromBoard: () => state.boards.map(b => ({ value: b.id, label: b.name }))
};

function fillBulkValue() {
  const sel = $('bulk-value');
  const make = BULK_VALUES[$('bulk-action').value];
  sel.style.display = make ? '' : 'none';
  sel.innerHTML = '';
  if (!make) return;
  sel.add(new Option('Choose…', ''));
  make().sort((a, b) => byName(a.label, b.label)).forEach(o => sel.add(new Option(o.label, o.value)));
}

// Builds the request body for the chosen action, or null when it isn't complete yet.
function bulkPayload(action, value) {
  switch (action) {
    case 'tag': case 'untag': return value ? { action, tag: value } : null;
    case 'setType': return value ? { action, type: value === NO_TYPE ? '' : value } : null;
    case 'addToBoard': case 'removeFromBoard': return value ? { action, boards: value } : null;
    case 'favorite': return { action: 'favorite', value: true };
    case 'unfavorite': return { action: 'favorite', value: false };
    default: return null;
  }
}

export function setupBulk() {
  $('bulk-toggle').addEventListener('click', () => setBulkMode(!state.bulkMode));
  $('bulk-cancel').addEventListener('click', () => setBulkMode(false));
  $('bulk-action').addEventListener('change', fillBulkValue);

  $('bulk-apply').addEventListener('click', async () => {
    if (state.selectedIds.size === 0) { toastError('Select some entries first.'); return; }
    const payload = bulkPayload($('bulk-action').value, $('bulk-value').value);
    if (!payload) { toastError('Choose an action and a value.'); return; }
    const count = state.selectedIds.size;
    await api.post('/api/entries/bulk', { ids: [...state.selectedIds], ...payload });
    // The server may have registered new tags/types, so reload everything it owns.
    [state.entries, state.tags, state.types] = await Promise.all([api.get('/api/entries'), api.get('/api/tags'), api.get('/api/types')]);
    state.selectedIds.clear();
    updateBulkCount();
    renderBrowse();
    toastSuccess(`Updated ${count} ${count === 1 ? 'entry' : 'entries'}.`);
  });

  $('bulk-delete').addEventListener('click', () => {
    if (state.selectedIds.size === 0) return;
    const ids = [...state.selectedIds];
    confirm_(`Delete ${ids.length} selected entries?`, () => {
      setBulkMode(false);
      deleteEntriesWithUndo(ids);
    });
  });
}

// Removes entries from view immediately and shows an "Undo" toast; the actual
// server delete (which also removes the screenshot files) only fires once the
// toast's 5s window elapses without Undo being clicked.
export function deleteEntriesWithUndo(ids) {
  const removed = ids
    .map(id => ({ id, idx: state.entries.findIndex(e => e.id === id) }))
    .filter(r => r.idx !== -1)
    .map(r => ({ ...r, entry: state.entries[r.idx] }));
  if (removed.length === 0) return;

  [...removed].sort((a, b) => b.idx - a.idx).forEach(r => state.entries.splice(r.idx, 1));
  refreshViews();

  let undone = false;
  const timer = setTimeout(async () => {
    if (undone) return;
    try {
      await api.post('/api/entries/bulk', { ids, action: 'delete' });
    } catch {
      toastError('Failed to delete. Reloading entries.');
      state.entries = await api.get('/api/entries');
      refreshViews();
    }
  }, 5000);

  showToast(removed.length === 1 ? 'Entry deleted.' : `${removed.length} entries deleted.`, {
    duration: 5000,
    actionLabel: 'Undo',
    onAction: () => {
      undone = true;
      clearTimeout(timer);
      [...removed].sort((a, b) => a.idx - b.idx).forEach(r => state.entries.splice(r.idx, 0, r.entry));
      refreshViews();
    }
  });
}

function refreshViews() {
  renderBrowse();
  if (state.view === 'favorites') renderFavorites();
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

// Shift-click range select: selects every card between the last-clicked
// entry (anchor) and the one just shift-clicked, in their on-screen order.
function selectRange(anchorId, targetId, container) {
  const cards = [...container.children];
  const ids = cards.map(el => el.dataset.id);
  const a = ids.indexOf(anchorId);
  const b = ids.indexOf(targetId);
  if (a === -1 || b === -1) return;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) {
    state.selectedIds.add(ids[i]);
    cards[i].classList.add('selected');
  }
  updateBulkCount();
}

function updateBulkCount() {
  $('bulk-count').textContent = `${state.selectedIds.size} selected`;
}

// ═══════════════════════════════════════════ FAVORITES ══
export async function toggleFavorite(id) {
  const idx = state.entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  const updated = await api.put(`/api/entries/${id}`, { favorite: !state.entries[idx].favorite });
  state.entries[idx] = updated;
  refreshViews();
}

export function renderFavorites() {
  const favs = state.entries.filter(e => e.favorite).sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  if (state.view === 'favorites') state.navIds = favs.map(e => e.id);
  renderGrid($('fav-grid'), favs);
  $('fav-empty').style.display = favs.length === 0 ? '' : 'none';
}
