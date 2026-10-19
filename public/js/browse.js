// Browse view: search, filters, sort, the gallery/masonry/list renderers, bulk
// actions, favorites, and the sidebar counters.

import {
  state, COLORS, COLOR_NAMES, PLACEHOLDER_SVG, OPEN_ICON, byName, cleanUrl, titleOf, safeHref, thumbImg, faviconImg, coverOf,
  colorName, defaultFilters, brandPrice, priceDrop, isBought, spaceKey, priceOf, priceTotal, boardLabel, escHtml, hasFoundVia
} from './state.js';
import { api } from './api.js';
import { inAddedRange, fuzzyMatch } from './lib.js';
import { hostOf, guessFashionFields, cleanTitle } from './autofill.js';
import { confirm_, prompt_, toastSuccess, toastError, showToast } from './modals.js';
import { openDetail } from './entry.js';
import { openTriage } from './triage.js';
import { removeEntryFromBoard, reorderInBoard, renderSidebarBoards } from './boards.js';

const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════ SEARCH ══
export function setupSearch() {
  const input = $('search-input');
  const clear = $('search-clear');

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
// Filters, sort, grouping, card size and layout persist across reloads, the same way
// theme does (the search text does not: last week's query would greet you with an
// empty list). Each space keeps its own, and this is also what runs when the space is switched.
const LAYOUTS = ['gallery', 'masonry', 'list'];

export function loadPersistedFilters() {
  state.filters = defaultFilters(state.space);
  state.sort = 'newest';
  state.group = '';
  state.cardSize = 220;
  state.layout = state.space === 'fashion' ? 'masonry' : 'gallery'; // product shots are mostly portrait
  try {
    const saved = JSON.parse(localStorage.getItem(spaceKey('omniview-filters')));
    if (saved && saved.filters) Object.assign(state.filters, { ...saved.filters, q: '' });
    if (saved && saved.sort) state.sort = saved.sort;
    if (saved && saved.group) state.group = saved.group;
    if (saved && saved.cardSize) state.cardSize = saved.cardSize;
    const layout = localStorage.getItem(spaceKey('omniview-layout'));
    if (LAYOUTS.includes(layout)) state.layout = layout;
  } catch { /* ignore malformed/missing storage */ }
  $('search-input').value = state.filters.q;
  $('search-clear').style.display = state.filters.q ? '' : 'none';
  syncLayoutButtons();
  applyCardSize();
}

function persistFilters() {
  try {
    localStorage.setItem(spaceKey('omniview-filters'), JSON.stringify({ filters: { ...state.filters, q: '' }, sort: state.sort, group: state.group, cardSize: state.cardSize }));
  } catch { /* storage unavailable */ }
}

export function setupFilters() {
  $('filter-fav').addEventListener('click', () => {
    state.filters.favorite = !state.filters.favorite;
    renderBrowse();
  });

  $('filter-bought').addEventListener('click', () => {
    state.filters.hideBought = !state.filters.hideBought;
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

  // Clears every filter but the search text and tag mode.
  $('filter-clear').addEventListener('click', () => {
    const { q, tagMode } = state.filters;
    state.filters = { ...defaultFilters(state.space), q, tagMode };
    renderBrowse();
  });

  $('brand-rename-btn').addEventListener('click', () => {
    const old = state.filters.brand;
    $('filter-brand-dd').open = false;
    prompt_(`Rename “${old}” to (an existing brand merges them):`, old, async name => {
      if (!name || name === old) return;
      try {
        const { updated } = await api.put(`/api/brands/${encodeURIComponent(old)}`, { newName: name });
        state.filters.brand = name;
        await reloadEntries();
        toastSuccess(`${updated} ${updated === 1 ? 'item' : 'items'} now ${name}.`);
      } catch (err) { toastError(err.message); }
    });
  });

  $('triage-btn').addEventListener('click', openTriage);
  $('refresh-prices-btn').addEventListener('click', refreshPrices);

  $('filter-tags-search').addEventListener('input', e => {
    tagQuery = e.target.value.trim().toLowerCase();
    renderTagFilters();
  });
  $('filter-tags-dd').addEventListener('toggle', e => { if (e.target.open) $('filter-tags-search').focus(); });

  ['filter-from', 'filter-to'].forEach(id => $(id).addEventListener('change', () => {
    state.filters.from = $('filter-from').value;
    state.filters.to = $('filter-to').value;
    state.filters.added = state.filters.from || state.filters.to ? 'custom' : '';
    renderBrowse();
  }));

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
    item.className = 'filter-option' + (o.value === current ? ' selected' : '') + (o.count === 0 && o.value !== current ? ' zero' : '');
    item.append(o.label);
    if (o.count !== undefined) item.append(countSpan(o.count));
    item.addEventListener('click', () => { dd.open = false; onPick(o.value); });
    list.appendChild(item);
  });
}

const countSpan = n => Object.assign(document.createElement('span'), { className: 'filter-opt-count', textContent: n });

// How many entries each option would leave under the other active filters, so
// empty options can be dimmed. `skip` is the filter the options belong to.
function facetCounts(skip, keysOf) {
  const counts = new Map();
  applyFilters(state.entries, skip).forEach(e => keysOf(e).forEach(k => counts.set(k, (counts.get(k) || 0) + 1)));
  return counts;
}

function renderTypeFilter() {
  const counts = facetCounts('type', e => [e.type]);
  renderSingleFilter(
    'filter-type-dd', 'filter-type-list', 'filter-type-label', 'All Types',
    [...state.types].sort(byName).map(t => ({ value: t, label: t, count: counts.get(t) || 0 })),
    state.filters.type,
    v => { state.filters.type = v; renderBrowse(); }
  );
}

function renderBrandFilter() {
  $('brand-rename-btn').style.display = state.filters.brand ? '' : 'none';
  const counts = facetCounts('brand', e => [e.brand]);
  const brands = [...new Set(state.entries.map(e => e.brand).filter(Boolean))];
  renderSingleFilter(
    'filter-brand-dd', 'filter-brand-list', 'filter-brand-label', 'All Brands',
    brands.sort(byName).map(v => ({ value: v, label: v, count: counts.get(v) || 0 })),
    state.filters.brand,
    v => { state.filters.brand = v; renderBrowse(); }
  );
}

function renderShopFilter() {
  const counts = facetCounts('shop', e => [hostOf(e.url)]);
  renderSingleFilter(
    'filter-shop-dd', 'filter-shop-list', 'filter-shop-label', 'All Shops',
    [...counts.keys()].filter(Boolean).sort(byName).map(v => ({ value: v, label: v, count: counts.get(v) || 0 })),
    state.filters.shop,
    v => { state.filters.shop = v; renderBrowse(); }
  );
}

function renderViaFilter() {
  const counts = facetCounts('via', e => [e.found_via]);
  renderSingleFilter(
    'filter-via-dd', 'filter-via-list', 'filter-via-label', 'Any Source',
    [...state.foundVia].sort(byName).map(v => ({ value: v, label: v, count: counts.get(v) || 0 })),
    state.filters.via,
    v => { state.filters.via = v; renderBrowse(); }
  );
}

// Presets plus a from/to pair; typing a date switches the pill to "custom".
const ADDED_PRESETS = [{ value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }];

function renderAddedFilter() {
  const f = state.filters;
  renderSingleFilter('filter-added-dd', 'filter-added-list', 'filter-added-label', 'Any Date', ADDED_PRESETS, f.added,
    v => { Object.assign(state.filters, { added: v, from: '', to: '' }); renderBrowse(); });
  if (f.added === 'custom') {
    $('filter-added-label').textContent = `${f.from || '…'} → ${f.to || '…'}`;
    $('filter-added-dd').classList.add('active');
  }
  $('filter-from').value = f.from;
  $('filter-to').value = f.to;
}

let tagQuery = '';

function renderTagFilters() {
  const wrap = $('filter-tags');
  wrap.innerHTML = '';
  // Adding a tag narrows the results in ALL mode but widens them in ANY mode.
  const counts = facetCounts(state.filters.tagMode === 'all' ? '' : 'tags', e => e.style_tags);
  const shown = [...state.tags].sort(byName).filter(t => t.toLowerCase().includes(tagQuery));
  shown.forEach(tag => {
    const label = document.createElement('label');
    if (!counts.get(tag) && !state.filters.tags.includes(tag)) label.className = 'zero';
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
    label.appendChild(countSpan(counts.get(tag) || 0));
    wrap.appendChild(label);
  });
  if (shown.length === 0) wrap.innerHTML = `<div class="filter-check-empty">${escHtml(state.tags.length === 0 ? 'No tags yet.' : 'No matching tags.')}</div>`;

  const n = state.filters.tags.length;
  const count = $('filter-tags-count');
  count.textContent = n;
  count.style.display = n ? '' : 'none';
  $('filter-tags-clear').style.display = n ? '' : 'none';
  $('filter-tags-dd').classList.toggle('active', n > 0);
  $('tag-mode-toggle').style.display = n > 1 ? '' : 'none';
  document.querySelectorAll('.tag-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.filters.tagMode));
}

export function renderBoardFilters() {
  $('filter-boards-dd').style.display = state.boards.length === 0 ? 'none' : '';
  const counts = facetCounts('board', e => e.boards);
  renderSingleFilter(
    'filter-boards-dd', 'filter-boards-list', 'filter-boards-label', 'All Boards',
    state.boards.map(b => ({ value: b.id, label: boardLabel(b), count: counts.get(b.id) || 0 })),
    state.filters.board,
    v => { state.filters.board = v; renderBrowse(); }
  );
}

// Swatch grid: an entry matches a color when its Color field is that name, or
// (UI space only: fashion palettes are mostly white backdrop) one of its three
// dominant palette colors falls in that name's bucket.
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

// ─── Sort & group ──────────────────────────────────────────────
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
  { value: 'type', label: 'By Type' },
  { value: 'brand', label: 'Brand A–Z', fashion: true },
  { value: 'price-asc', label: 'Price: Low → High', fashion: true },
  { value: 'price-desc', label: 'Price: High → Low', fashion: true },
  { value: 'favorites', label: 'Favorites first' },
  { value: 'edited', label: 'Recently edited' },
  { value: 'shuffle', label: 'Shuffle' }
];
const visibleSorts = () => SORT_OPTIONS.filter(o => !o.fashion || state.space === 'fashion');

// key() buckets an entry; '' means it has none and lands under `none`, listed last.
// Tag and board use the first one only, so an entry shows once.
const monthKey = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const boardName = id => state.boards.find(b => b.id === id)?.name;
const GROUPS = {
  month: { label: 'Month added', key: e => monthKey(e.date_added), title: k => new Date(`${k}-15`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) },
  type: { label: 'Type', key: e => e.type, none: 'No type' },
  brand: { label: 'Brand', key: e => e.brand, none: 'No brand', fashion: true },
  shop: { label: 'Shop', key: e => hostOf(e.url), none: 'No shop', fashion: true },
  tag: { label: 'Tag', key: e => e.style_tags[0], none: 'No tags' },
  board: { label: 'Board', key: e => boardName(e.boards[0]), none: 'No board' }
};
const visibleGroups = () => Object.entries(GROUPS).filter(([, g]) => !g.fashion || state.space === 'fashion');

// The Group control wins; otherwise sorting by type/brand still puts headings in.
const activeGroup = () => (visibleGroups().some(([k]) => k === state.group) ? state.group : '') || (state.sort === 'type' || state.sort === 'brand' ? state.sort : '');

// [[heading | null, entries]]. Month groups follow the sort direction, the rest run A–Z.
function groupEntries(entries) {
  const by = activeGroup();
  if (!by) return [[null, entries]];
  const g = GROUPS[by];
  const buckets = new Map();
  entries.forEach(e => {
    const k = g.key(e) || '';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  });
  const dir = by === 'month' ? (state.sort === 'oldest' ? 1 : -1) : 1;
  const keys = [...buckets.keys()].sort((a, b) => (a === '') - (b === '') || dir * a.localeCompare(b));
  return keys.map(k => [k ? (g.title ? g.title(k) : k) : g.none, buckets.get(k)]);
}

// Entries without a price go last in both directions.
const byPrice = dir => (a, b) => {
  const pa = priceOf(a), pb = priceOf(b);
  return pa === null || pb === null ? (pa === null) - (pb === null) : dir * (pa - pb);
};

// Random order assigned on first sight, so Shuffle stays put until the page reloads.
const shuffleRank = new Map();
const rankOf = e => {
  if (!shuffleRank.has(e.id)) shuffleRank.set(e.id, Math.random());
  return shuffleRank.get(e.id);
};

function sortEntries(entries) {
  const list = [...entries];
  const byNewest = (a, b) => new Date(b.date_added) - new Date(a.date_added);
  switch (state.sort) {
    case 'oldest': return list.sort((a, b) => new Date(a.date_added) - new Date(b.date_added));
    case 'az': return list.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    case 'type': return list.sort((a, b) => (a.type || '').localeCompare(b.type || '') || byNewest(a, b));
    case 'brand': return list.sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || byNewest(a, b));
    case 'price-asc': return list.sort(byPrice(1));
    case 'price-desc': return list.sort(byPrice(-1));
    case 'favorites': return list.sort((a, b) => b.favorite - a.favorite || byNewest(a, b));
    case 'edited': return list.sort((a, b) => new Date(b.updated_at || b.date_added) - new Date(a.updated_at || a.date_added));
    case 'shuffle': return list.sort((a, b) => rankOf(a) - rankOf(b));
    default: return list.sort(byNewest);
  }
}

// A dropdown of plain choices ("Sort: Newest").
function renderMenu(prefix, name, options, current, onPick) {
  const dd = $(`filter-${prefix}-dd`);
  const list = $(`filter-${prefix}-list`);
  const chosen = options.find(o => o.value === current) || options[0];
  $(`filter-${prefix}-label`).textContent = `${name}: ${chosen.label}`;
  list.innerHTML = '';
  options.forEach(o => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'filter-option' + (o.value === chosen.value ? ' selected' : '');
    item.textContent = o.label;
    item.addEventListener('click', () => { dd.open = false; onPick(o.value); });
    list.appendChild(item);
  });
}

const renderSortFilter = () => renderMenu('sort', 'Sort', visibleSorts(), state.sort, v => { state.sort = v; renderBrowse(); });
const renderGroupFilter = () => renderMenu('group', 'Group',
  [{ value: '', label: 'None' }, ...visibleGroups().map(([value, g]) => ({ value, label: g.label }))],
  state.group, v => { state.group = v; renderBrowse(); });

// ═══════════════════════════════════════════ BROWSE ══
// The browser holds the whole library, so filtering lives here and only here.
const matchesQuery = (e, q) =>
  e.title.toLowerCase().includes(q) ||
  (e.brand || '').toLowerCase().includes(q) ||
  e.url.toLowerCase().includes(q) ||
  e.note.toLowerCase().includes(q) ||
  e.style_tags.some(t => t.toLowerCase().includes(q));

// `skip` leaves one filter out (type, brand, shop, via, board or tags), for the facet counts;
// `noQuery` leaves the search text out (the fuzzy fallback matches that itself).
function applyFilters(entries, skip = '', noQuery = false) {
  let list = entries;
  const f = state.filters;
  if (f.q && !noQuery) {
    const q = f.q.toLowerCase();
    list = list.filter(e => matchesQuery(e, q));
  }
  if (f.type && skip !== 'type') list = list.filter(e => e.type === f.type);
  if (f.brand && skip !== 'brand') list = list.filter(e => e.brand === f.brand);
  if (f.shop && skip !== 'shop') list = list.filter(e => hostOf(e.url) === f.shop);
  if (f.via && skip !== 'via' && hasFoundVia()) list = list.filter(e => e.found_via === f.via);
  if (f.added) list = list.filter(e => inAddedRange(e.date_added, f));
  if (f.hideBought) list = list.filter(e => !isBought(e));
  if (f.tags.length && skip !== 'tags') {
    list = f.tagMode === 'all'
      ? list.filter(e => f.tags.every(t => e.style_tags.includes(t)))
      : list.filter(e => f.tags.some(t => e.style_tags.includes(t)));
  }
  if (f.board && skip !== 'board') list = list.filter(e => e.boards.includes(f.board));
  if (f.color) {
    const fromPalette = state.space !== 'fashion';
    list = list.filter(e => e.color === f.color || (fromPalette && e.palette.slice(0, 3).some(h => colorName(h) === f.color)));
  }
  if (f.favorite) list = list.filter(e => e.favorite);
  return list;
}

// One removable chip per active dropdown/tag filter; each `drop` returns the patch that undoes it.
function filterChips() {
  const f = state.filters;
  const chips = [];
  const add = (text, drop) => chips.push({ text, drop });
  if (f.type) add(`type: ${f.type}`, () => ({ type: '' }));
  if (f.brand) add(`brand: ${f.brand}`, () => ({ brand: '' }));
  if (f.shop) add(`shop: ${f.shop}`, () => ({ shop: '' }));
  f.tags.forEach(t => add(`tag: ${t}`, () => ({ tags: state.filters.tags.filter(x => x !== t) })));
  if (f.board) add(`board: ${boardName(f.board) || '?'}`, () => ({ board: '' }));
  if (f.via && hasFoundVia()) add(`via: ${f.via}`, () => ({ via: '' }));
  if (f.color) add(`color: ${f.color}`, () => ({ color: '' }));
  if (f.added) add(`added: ${f.added === 'custom' ? `${f.from || '…'} → ${f.to || '…'}` : `this ${f.added}`}`, () => ({ added: '', from: '', to: '' }));
  return chips;
}

function renderChips(chips) {
  const wrap = $('active-chips');
  wrap.style.display = chips.length ? '' : 'none';
  wrap.innerHTML = '';
  chips.forEach(c => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip active filter-chip';
    chip.title = 'Remove this filter';
    chip.textContent = `${c.text} ✕`;
    chip.addEventListener('click', () => { Object.assign(state.filters, c.drop()); renderBrowse(); });
    wrap.appendChild(chip);
  });
}

// ─── Scroll & focus survive a rebuild ──────────────────────────
let lastIds = [];

// Rebuilding the grid empties it for a moment (masonry thumbnails have no height
// until they decode), which would clamp the page scroll. Hold the height, put the
// scroll back, and focus the card that had it.
function keepPlace(rebuild, ids) {
  const same = ids.length === lastIds.length && ids.every((id, i) => id === lastIds[i]);
  lastIds = ids;
  const box = $('view-browse').querySelector('.grid-container');
  const y = window.scrollY;
  const focused = document.activeElement?.closest?.('[data-id]')?.dataset.id;
  if (same && y > 0) box.style.minHeight = `${box.offsetHeight}px`;
  rebuild();
  if (same && y > 0) {
    window.scrollTo(0, y);
    setTimeout(() => { box.style.minHeight = ''; }, 400);
  }
  if (focused) focusCard(focused, false);
}

// Focuses an entry's card in the visible view; `reveal` scrolls it into view if it's off screen.
export function focusCard(id, reveal = true) {
  const card = $(`view-${state.view}`)?.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  card.focus({ preventScroll: true });
  if (reveal) card.scrollIntoView({ block: 'nearest' });
}

export function renderBrowse() {
  const f = state.filters;
  const chips = filterChips();
  renderTypeFilter();
  renderBrandFilter();
  renderShopFilter();
  renderTagFilters();
  renderBoardFilters();
  renderViaFilter();
  renderColorFilter();
  renderAddedFilter();
  renderSortFilter();
  renderGroupFilter();
  renderChips(chips);
  [['filter-fav', f.favorite], ['filter-bought', f.hideBought]].forEach(([id, on]) => {
    $(id).classList.toggle('active', on);
    $(id).setAttribute('aria-pressed', String(on));
  });
  $('filter-clear').style.display = chips.length || f.favorite || f.hideBought !== defaultFilters(state.space).hideBought ? '' : 'none';
  $('triage-btn').style.display = state.entries.some(e => !e.style_tags.length) ? '' : 'none'; // only shown in the UI library (.ui-only)

  let matched = applyFilters(state.entries);
  // A typo should not read as "nothing": retry the search allowing one slip per word.
  let fuzzy = false;
  if (!matched.length && f.q) {
    matched = applyFilters(state.entries, '', true).filter(e => fuzzyMatch(e, f.q));
    fuzzy = matched.length > 0;
  }
  const filtered = sortEntries(matched);
  const groups = groupEntries(filtered);
  const ordered = groups.flatMap(([, list]) => list); // on-screen order, which grouping can change
  if (state.view === 'browse') state.navIds = ordered.map(e => e.id);

  const grid = $('entry-grid');
  const list = $('entry-list');
  const asList = state.layout === 'list';

  keepPlace(() => {
    if (asList) renderList(list, filtered, true, groups);
    else renderGrid(grid, filtered, true, null, groups);
  }, ordered.map(e => e.id));
  grid.classList.toggle('masonry', state.layout === 'masonry');

  grid.style.display = !asList && filtered.length ? '' : 'none';
  list.style.display = asList && filtered.length ? '' : 'none';
  $('browse-empty').style.display = filtered.length === 0 ? '' : 'none';
  $('browse-onboarding').style.display = state.entries.length === 0 ? '' : 'none';
  $('browse-no-match').style.display = state.entries.length === 0 ? 'none' : '';
  if (!filtered.length && state.entries.length) renderNoMatchFixes();
  $('result-count').textContent = [`${filtered.length} of ${state.entries.length}`, fuzzy && 'close matches', priceTotal(filtered)].filter(Boolean).join(' · ');
  updateStats();
  persistFilters();
}

// "Remove Shoes → 8 results": for an empty list, what dropping each active filter (or the search) would give.
function renderNoMatchFixes() {
  const saved = state.filters;
  const options = filterChips().map(c => ({ text: c.text.replace(/^[a-z]+: /, ''), patch: c.drop() }));
  if (saved.q) options.push({ text: `the search “${saved.q}”`, patch: { q: '' } });
  if (saved.favorite) options.push({ text: 'Favorites', patch: { favorite: false } });
  if (saved.hideBought) options.push({ text: 'Hide bought', patch: { hideBought: false } });
  const counted = options.map(o => {
    state.filters = { ...saved, ...o.patch };
    const n = applyFilters(state.entries).length;
    state.filters = saved;
    return { ...o, n };
  }).filter(o => o.n > 0).sort((a, b) => b.n - a.n).slice(0, 4);
  $('no-match-fixes').replaceChildren(...counted.map(o => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = `Remove ${o.text} → ${o.n} ${o.n === 1 ? 'result' : 'results'}`;
    btn.addEventListener('click', () => {
      Object.assign(state.filters, o.patch);
      if ('q' in o.patch) { $('search-input').value = ''; $('search-clear').style.display = 'none'; }
      renderBrowse();
    });
    return btn;
  }));
}

// Sidebar counters, derived from what's already loaded.
export function updateStats() {
  const fashion = state.space === 'fashion';
  const noun = fashion ? 'item' : 'entr';
  const n = state.entries.length;
  $('stats-line').textContent = [`${n} ${noun}${n === 1 ? (fashion ? '' : 'y') : (fashion ? 's' : 'ies')}`, priceTotal(state.entries)].filter(Boolean).join(' · ');
  $('nav-boards-count').textContent = state.boards.length || '';
  renderSidebarBoards();
}

// ═══════════════════════════════════════════ LAYOUT SWITCH ══
export function setupLayoutSwitch() {
  $('view-switch').addEventListener('click', e => {
    const btn = e.target.closest('.view-switch-btn');
    if (!btn || btn.dataset.layout === state.layout) return;
    state.layout = btn.dataset.layout;
    try { localStorage.setItem(spaceKey('omniview-layout'), state.layout); } catch { /* storage unavailable */ }
    syncLayoutButtons();
    renderBrowse();
  });
  $('card-size').addEventListener('input', e => {
    state.cardSize = Number(e.target.value);
    applyCardSize();
    persistFilters();
  });
  syncLayoutButtons();
  applyCardSize();
}

function applyCardSize() {
  document.documentElement.style.setProperty('--card-min', `${state.cardSize}px`);
  $('card-size').value = state.cardSize;
}

function syncLayoutButtons() {
  document.querySelectorAll('.view-switch-btn').forEach(b => {
    const on = b.dataset.layout === state.layout;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('card-size').style.display = state.layout === 'list' ? 'none' : '';
}

// Group headings the user folded away this session ("brand:Dr. Martens"); their entries stay in the count.
const collapsed = new Set();

// `groups` is [[heading | null, entries]] (Browse only); plain callers pass just `entries`.
function appendEntries(el, entries, groups, make) {
  el.innerHTML = '';
  (groups || [[null, entries]]).forEach(([heading, list]) => {
    const key = `${activeGroup()}:${heading}`;
    const folded = heading !== null && collapsed.has(key);
    if (heading !== null) {
      const h = document.createElement('div');
      h.className = 'group-heading' + (folded ? ' collapsed' : '');
      h.tabIndex = 0;
      h.setAttribute('role', 'button');
      h.setAttribute('aria-expanded', String(!folded));
      const total = priceTotal(list); // Fashion only
      h.append(heading, Object.assign(document.createElement('span'), { textContent: list.length }),
        ...(total && total !== '$0' ? [Object.assign(document.createElement('span'), { className: 'group-total', textContent: total })] : []));
      const toggle = () => { if (!collapsed.delete(key)) collapsed.add(key); renderBrowse(); };
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      el.appendChild(h);
    }
    if (!folded) list.forEach(entry => el.appendChild(make(entry)));
  });
}

export function renderGrid(gridEl, entries, clickOpensDetail = true, boardId = null, groups = null) {
  appendEntries(gridEl, entries, groups, entry => createCard(entry, clickOpensDetail, boardId));
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
  a.addEventListener('click', e => { e.stopPropagation(); markVisited([entry.id]); });
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

let draggedEntryId = null; // entry being dragged inside a board

function createCard(entry, clickOpensDetail, boardId = null) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.id = entry.id;
  card.tabIndex = 0;
  if (state.selectedIds.has(entry.id)) card.classList.add('selected');
  if (!coverOf(entry)) card.classList.add('no-shot');
  if (state.sinceOpen && Date.parse(entry.date_added) > state.sinceOpen) card.classList.add('is-new');
  if (entry.visited_at) card.classList.add('visited');
  card.title = entry.visited_at ? `Site last opened ${new Date(entry.visited_at).toLocaleDateString()}` : '';

  const isMobile = entry.type === 'Mobile App';
  const thumb = document.createElement('div');
  thumb.className = 'thumb-wrap' + (isMobile ? ' mobile' : '');
  if (entry.palette[0]) thumb.style.backgroundColor = entry.palette[0]; // shows while the thumbnail loads

  if (coverOf(entry)) {
    thumb.appendChild(thumbImg(coverOf(entry), titleOf(entry)));
  } else {
    thumb.innerHTML = `<div class="thumb-placeholder">${PLACEHOLDER_SVG}<span>No screenshot</span></div>`;
  }

  // A page image fetched from the entry's URL stands in for a screenshot the user took
  // (in Fashion the page's product photo is the right image, so no badge there).
  if (state.space !== 'fashion' && coverOf(entry) && (entry.remote_shots || []).includes(coverOf(entry))) {
    const badge = document.createElement('span');
    badge.className = 'shot-badge';
    badge.textContent = 'Page image';
    thumb.appendChild(badge);
  }

  // Status badges that stay visible without hovering
  const flags = [entry.bought && 'Bought'].filter(Boolean);
  if (flags.length) {
    const flagEl = document.createElement('span');
    flagEl.className = 'card-flags';
    flagEl.textContent = flags.join(' · ');
    thumb.appendChild(flagEl);
  }

  // Overlay: open, fav (+ remove-from-board); copy and boards live in the detail view
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

    // Drag onto another board's drop target (see boards.js), or onto a sibling card to reorder.
    card.draggable = true;
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', entry.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      draggedEntryId = entry.id;
    });
    card.addEventListener('dragend', () => { draggedEntryId = null; });
    card.addEventListener('dragover', e => { if (draggedEntryId && draggedEntryId !== entry.id) e.preventDefault(); });
    card.addEventListener('drop', e => {
      if (!draggedEntryId || draggedEntryId === entry.id) return;
      e.preventDefault();
      reorderInBoard(boardId, draggedEntryId, entry.id);
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

  if (brandPrice(entry)) {
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.textContent = brandPrice(entry);
    if (priceDrop(entry)) meta.append(' ', Object.assign(document.createElement('span'), { className: 'price-drop', textContent: priceDrop(entry) }));
    body.appendChild(meta);
  }

  if (entry.style_tags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'card-tags';
    appendTagChips(tagsEl, entry.style_tags);
    body.appendChild(tagsEl);
  }

  card.appendChild(thumb);
  card.appendChild(body);
  card.addEventListener('click', e => onItemClick(e, card, entry, clickOpensDetail));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === card) card.click(); });
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
function renderList(listEl, entries, clickOpensDetail = true, groups = null) {
  appendEntries(listEl, entries, groups, entry => createRow(entry, clickOpensDetail));
}

function createRow(entry, clickOpensDetail) {
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.dataset.id = entry.id;
  if (state.selectedIds.has(entry.id)) row.classList.add('selected');
  if (entry.visited_at) row.classList.add('visited');
  if (state.sinceOpen && Date.parse(entry.date_added) > state.sinceOpen) row.classList.add('is-new');

  const check = document.createElement('div');
  check.className = 'row-check';
  check.textContent = '✓';

  const thumb = document.createElement('div');
  thumb.className = 'row-thumb';
  if (entry.palette[0]) thumb.style.backgroundColor = entry.palette[0];
  if (coverOf(entry)) {
    thumb.appendChild(thumbImg(coverOf(entry)));
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
  url.textContent = [entry.bought && 'Bought', entry.visited_at && '✓ visited', brandPrice(entry), priceDrop(entry), cleanUrl(entry.url)].filter(Boolean).join(' · ');
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
  actions.append(favButton(entry));
  const open = openLink(entry, 'row-open', 'Open source');
  if (open) actions.appendChild(open);

  row.append(check, thumb, main, type, tags, actions);
  row.addEventListener('click', e => onItemClick(e, row, entry, clickOpensDetail));
  return row;
}

// ═══════════════════════════════════════════ BULK ══
// Bulk mode paints both layouts, so every entry point goes through here.
export function setBulkMode(on) {
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
  setColor: () => [{ value: NO_TYPE, label: '— None —' }, ...COLOR_NAMES.map(c => ({ value: c, label: c }))],
  setFoundVia: () => [{ value: NO_TYPE, label: '— None —' }, ...state.foundVia.map(v => ({ value: v, label: v }))],
  addToBoard: () => state.boards.map(b => ({ value: b.id, label: boardLabel(b) })),
  removeFromBoard: () => state.boards.map(b => ({ value: b.id, label: boardLabel(b) }))
};

function fillBulkValue() {
  const sel = $('bulk-value');
  const action = $('bulk-action').value;
  const make = BULK_VALUES[action];
  sel.style.display = make ? '' : 'none';
  sel.innerHTML = '';
  // Brand is free text: a field with the brands you already use as suggestions.
  $('bulk-text').style.display = action === 'setBrand' ? '' : 'none';
  $('bulk-text').value = '';
  $('bulk-brands').replaceChildren(...[...new Set(state.entries.map(e => e.brand).filter(Boolean))].sort(byName).map(b => new Option(b)));
  if (!make) return;
  sel.add(new Option('Choose…', ''));
  make().sort((a, b) => (a.value === NO_TYPE ? -1 : b.value === NO_TYPE ? 1 : byName(a.label, b.label))).forEach(o => sel.add(new Option(o.label, o.value)));
}

// Builds the request body for the chosen action, or null when it isn't complete yet.
function bulkPayload(action, value) {
  switch (action) {
    case 'setBrand': return $('bulk-text').value.trim() ? { action, brand: $('bulk-text').value.trim() } : null;
    case 'setColor': return value ? { action, color: value === NO_TYPE ? '' : value } : null;
    case 'setFoundVia': return value ? { action, foundVia: value === NO_TYPE ? '' : value } : null;
    case 'tag': case 'untag': return value ? { action, tag: value } : null;
    case 'setType': return value ? { action, type: value === NO_TYPE ? '' : value } : null;
    case 'addToBoard': case 'removeFromBoard': return value ? { action, boards: value } : null;
    case 'favorite': return { action: 'favorite', value: true };
    case 'unfavorite': return { action: 'favorite', value: false };
    default: return null;
  }
}

// The one entry field each non-delete bulk action changes (the field Undo restores).
const UNDO_FIELD = { tag: 'style_tags', untag: 'style_tags', setType: 'type', setBrand: 'brand', setColor: 'color', setFoundVia: 'found_via', addToBoard: 'boards', removeFromBoard: 'boards', favorite: 'favorite' };

// The server may have registered new tags/types, so reload everything it owns.
async function reloadEntries() {
  [state.entries, state.tags, state.types, state.foundVia] = await Promise.all([api.get('/api/entries'), api.get('/api/tags'), api.get('/api/types'), api.get('/api/found-via')]);
  refreshViews();
  renderBoardFilters();
}

export function setupBulk() {
  $('bulk-toggle').addEventListener('click', () => setBulkMode(!state.bulkMode));
  $('bulk-cancel').addEventListener('click', () => setBulkMode(false));
  $('bulk-action').addEventListener('change', fillBulkValue);

  $('bulk-apply').addEventListener('click', async () => {
    if (state.selectedIds.size === 0) { toastError('Select some entries first.'); return; }
    if ($('bulk-action').value === 'autofill') { await bulkAutofill([...state.selectedIds]); return; }
    const payload = bulkPayload($('bulk-action').value, $('bulk-value').value);
    if (!payload) { toastError('Choose an action and a value.'); return; }
    const ids = [...state.selectedIds];
    // What each entry looked like, so Undo can put the one affected field back.
    const field = UNDO_FIELD[payload.action];
    const before = state.entries.filter(e => state.selectedIds.has(e.id)).map(e => ({ id: e.id, value: structuredClone(e[field]) }));
    const space = state.space;
    let res;
    try {
      res = await api.post('/api/entries/bulk', { ids, ...payload });
    } catch (err) {
      // The server applies a request all-or-nothing, so a failure means none changed; the selection stays for a retry.
      toastError(`Bulk update failed, nothing was changed: ${err.message}. ${ids.length} still selected.`);
      return;
    }
    const { updated, results } = res;
    await reloadEntries();
    state.selectedIds.clear();
    updateBulkCount();
    if (!updated) { showToast('0 updated: those entries no longer exist.'); return; }
    const missing = results.filter(r => !r.updated).length;
    const msg = missing
      ? `Updated ${updated} of ${ids.length} entries (${missing} no longer ${missing === 1 ? 'exists' : 'exist'}).`
      : `Updated ${updated} ${updated === 1 ? 'entry' : 'entries'}.`;
    showToast(msg, {
      duration: 5000,
      actionLabel: 'Undo',
      onAction: async () => {
        const restore = before.filter(b => results.find(r => r.id === b.id && r.updated));
        const outcomes = await Promise.allSettled(restore.map(b => api.put(`/api/entries/${b.id}`, { [field]: b.value }, space)));
        const failed = outcomes.filter(o => o.status === 'rejected').length;
        if (failed) toastError(`Undo restored ${restore.length - failed} of ${restore.length}; ${failed} failed.`);
        if (state.space === space) await reloadEntries();
      }
    });
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

// Deleting moves the entries to the trash at once; Undo takes them back out. Nothing waits
// on a timer, so closing the tab right after a delete cannot leave the entries behind.
export async function deleteEntriesWithUndo(ids) {
  const space = state.space; // the user may switch library before pressing Undo
  try {
    await api.post('/api/entries/bulk', { ids, action: 'delete' });
  } catch (err) {
    toastError(`Failed to delete: ${err.message}`);
    return;
  }
  state.entries = state.entries.filter(e => !ids.includes(e.id));
  refreshViews();

  showToast(ids.length === 1 ? 'Entry deleted.' : `${ids.length} entries deleted.`, {
    duration: 5000,
    actionLabel: 'Undo',
    onAction: async () => {
      const results = await Promise.allSettled(ids.map(id => api.post(`/api/trash/${id}/restore`, {}, space)));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) toastError(`Restored ${ids.length - failed} of ${ids.length}; ${failed} could not be restored (they are in the trash).`);
      if (state.space === space) await reloadEntries();
    }
  });
}

function refreshViews() {
  renderBrowse();
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
  const cards = [...container.children].filter(el => el.dataset.id); // skip group headings
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

// ═══════════════════════════════════════════ FLAGS ══
export async function toggleFlag(id, flag) {
  const idx = state.entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  const updated = await api.put(`/api/entries/${id}`, { [flag]: !state.entries[idx][flag] });
  state.entries[idx] = updated;
  refreshViews();
}

export const toggleFavorite = id => toggleFlag(id, 'favorite');

// Stamps entries whose site was just opened. Fire and forget: the card gets its mark now, the server catches up.
export async function markVisited(ids) {
  try {
    const { visited_at } = await api.post('/api/visit', { ids });
    const seen = new Set(ids);
    state.entries.forEach(e => { if (seen.has(e.id)) e.visited_at = visited_at; });
    document.querySelectorAll('.entry-card, .entry-row').forEach(el => {
      if (!seen.has(el.dataset.id) || el.classList.contains('visited')) return;
      el.classList.add('visited'); // the ✓ is CSS (.visited .card-url::after)
    });
  } catch { /* the badge is a convenience; the link already opened */ }
}

// ═══════════════════════════════════════════ RE-RUN AUTOFILL / REFRESH PRICES ══
const sleep = ms => new Promise(r => setTimeout(r, ms));
const unfurl = url => api.get(`/api/unfurl?url=${encodeURIComponent(url)}`);

// The blank fields of `e` that its page can fill. Never a field that already has a value.
function blankFills(e, info) {
  const guess = { title: cleanTitle(info.title || '', info.siteName, e.url) };
  if (state.space === 'fashion') {
    Object.assign(guess, guessFashionFields(info, e.url, { entries: state.entries.filter(x => x.id !== e.id), types: state.types, colors: COLOR_NAMES }));
  } else if (info.themeColor) {
    guess.color = colorName(info.themeColor);
  }
  return Object.fromEntries(['title', 'brand', 'price', 'type', 'color'].filter(f => guess[f] && !e[f]).map(f => [f, guess[f]]));
}

// "Re-run autofill (blanks only)": reads each selected entry's page, then lists what it would fill for review.
async function bulkAutofill(ids) {
  const btn = $('bulk-apply');
  const label = btn.textContent;
  const space = state.space;
  const targets = ids.map(id => state.entries.find(e => e.id === id)).filter(Boolean);
  const changes = [];
  let unreadable = 0;
  btn.disabled = true;
  for (const [i, e] of targets.entries()) {
    btn.textContent = `Reading ${i + 1} of ${targets.length}…`;
    try {
      const fills = blankFills(e, await unfurl(e.url));
      if (Object.keys(fills).length) changes.push({ entry: e, fills });
    } catch { unreadable++; }
  }
  btn.disabled = false;
  btn.textContent = label;
  const note = unreadable ? ` ${unreadable} page${unreadable === 1 ? '' : 's'} could not be read.` : '';
  if (!changes.length) return showToast(`Nothing to fill in.${note}`);
  confirm_(`Fill blank fields on ${changes.length} of ${targets.length} entries?${note}`, async () => {
    const results = await Promise.allSettled(changes.map(c => api.put(`/api/entries/${c.entry.id}`, c.fills, space)));
    const failed = results.filter(r => r.status === 'rejected').length;
    if (state.space === space) { await reloadEntries(); state.selectedIds.clear(); updateBulkCount(); }
    (failed ? toastError : toastSuccess)(failed ? `Filled ${changes.length - failed}; ${failed} failed.` : `Filled ${changes.length} ${changes.length === 1 ? 'entry' : 'entries'}.`);
  }, 'Fill in', changes.map(c => `${titleOf(c.entry)}: ${Object.entries(c.fills).map(([k, v]) => `${k} → ${v}`).join(', ')}`));
}

// Re-reads the price of every item in the current list, one at a time. Still a button you press (nothing runs in the
// background); it just saves opening fifteen entries one by one. A second press stops it.
let refreshing = false;

async function refreshPrices() {
  if (refreshing) { refreshing = false; return; }
  const targets = sortEntries(applyFilters(state.entries)).filter(e => e.url);
  if (!targets.length) return showToast('Nothing in the list to refresh.');
  const n = targets.length;
  confirm_(`Re-read the price of ${n} ${n === 1 ? 'item' : 'items'}, one at a time (about ${n} seconds)? Changed prices are saved, and the old one is kept as "was".`, async () => {
    const btn = $('refresh-prices-btn');
    const label = btn.textContent;
    const space = state.space;
    let changed = 0, fell = 0, failed = 0;
    refreshing = true;
    for (const [i, e] of targets.entries()) {
      if (!refreshing || state.space !== space) break;
      btn.textContent = `Stop (${i + 1}/${n})`;
      try {
        const price = String(guessFashionFields(await unfurl(e.url), e.url, { entries: [], types: [], colors: [] }).price || '');
        if (price && priceOf({ price }) !== priceOf(e)) {
          const updated = await api.put(`/api/entries/${e.id}`, { price, price_was: e.price }, space);
          const idx = state.entries.findIndex(x => x.id === e.id);
          if (idx !== -1) state.entries[idx] = updated;
          changed++;
          if (priceDrop(updated)) fell++;
          renderBrowse();
        }
      } catch { failed++; }
      await sleep(800);
    }
    refreshing = false;
    btn.textContent = label;
    renderBrowse();
    showToast(`${changed} ${changed === 1 ? 'price' : 'prices'} changed${fell ? `, ${fell} fell` : ''}${failed ? `; ${failed} could not be read` : ''}.`);
  }, 'Refresh');
}
