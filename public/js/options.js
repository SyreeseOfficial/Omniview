// The user-managed option lists (tags, types, found-via), the single-select
// combo dropdowns that edit them, and the Style Tags input widget.

import { state, COLOR_NAMES, CARET_SVG, byName } from './state.js';
import { api } from './api.js';
import { confirm_, prompt_ } from './modals.js';
import { renderBrowse } from './browse.js';
import { renderTagList, renderTypeList, renderFoundViaList } from './settings.js';
import { renderFormTagPills, renderDetailTagPills } from './entry.js';

// ═══════════════════════════════════════════ COMBO DROPDOWNS (Type / Color / Found via) ══
// A single-select dropdown built from the Style Tags widget's own classes, so
// every option field in the app shares one look. It is custom rather than a
// native <select> because a <select> cannot host a per-option delete button.

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
  color: { getOptions: () => COLOR_NAMES }
};

export const typeUsage = COMBO_KINDS.type.usage;
export const foundViaUsage = COMBO_KINDS.foundVia.usage;

const combos = {};

export function setupCombos() {
  ['f-type', 'detail-type'].forEach(id => initCombo(id, 'type'));
  ['f-color', 'detail-color'].forEach(id => initCombo(id, 'color'));
  ['f-found-via', 'detail-found-via'].forEach(id => initCombo(id, 'foundVia'));
}

function initCombo(id, kindName) {
  const root = document.getElementById(id);
  root.innerHTML =
    `<div class="combo-field" tabindex="0" role="combobox" aria-haspopup="listbox"><span class="combo-value"></span>${CARET_SVG}</div>` +
    '<div class="combo-dropdown tag-dropdown" style="display:none"></div>';

  combos[id] = { root, kind: COMBO_KINDS[kindName], value: '' };

  const field = root.querySelector('.combo-field');
  field.addEventListener('click', () => (isComboOpen(id) ? closeCombo(id) : openCombo(id)));
  field.addEventListener('keydown', e => {
    const dd = root.querySelector('.combo-dropdown');
    if (isComboOpen(id) && navigateDropdown(e, dd)) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isComboOpen(id)) openCombo(id); }
    if (e.key === 'Escape') closeCombo(id);
  });
  document.addEventListener('click', e => { if (!root.contains(e.target)) closeCombo(id); });
  setCombo(id, '');
}

export function comboValue(id) { return combos[id].value; }

export function setCombo(id, value) {
  const c = combos[id];
  c.value = value || '';
  const label = c.root.querySelector('.combo-value');
  label.textContent = c.value || '— None —';
  label.classList.toggle('is-empty', !c.value);
  c.root.classList.toggle('has-value', !!c.value);
  if (isComboOpen(id)) renderComboList(id);
}

// Up/Down moves the keyboard-highlighted row (".focused"), Enter activates it
// — shared by the Type/Color/Found-via combos and the Style Tags dropdown,
// whose option rows are otherwise mouse-only.
function navigateDropdown(e, dropdown) {
  if (dropdown.style.display === 'none') return false;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return false;

  const items = [...dropdown.children];
  if (!items.length) return false;
  const current = items.findIndex(el => el.classList.contains('focused'));

  if (e.key === 'Enter') {
    if (current === -1) return false;
    e.preventDefault();
    if (items[current]._activate) items[current]._activate();
    return true;
  }

  e.preventDefault();
  const next = e.key === 'ArrowDown'
    ? (current + 1) % items.length
    : (current - 1 + items.length) % items.length;
  items.forEach(el => el.classList.remove('focused'));
  items[next].classList.add('focused');
  items[next].scrollIntoView({ block: 'nearest' });
  return true;
}

function isComboOpen(id) { return combos[id].root.querySelector('.combo-dropdown').style.display !== 'none'; }
function openCombo(id) { combos[id].root.querySelector('.combo-dropdown').style.display = ''; renderComboList(id); }
function closeCombo(id) { combos[id].root.querySelector('.combo-dropdown').style.display = 'none'; }

function renderComboList(id) {
  const c = combos[id];
  const dd = c.root.querySelector('.combo-dropdown');
  dd.innerHTML = '';
  dd.setAttribute('role', 'listbox');

  if (c.kind.add) {
    const addNew = document.createElement('div');
    addNew.className = 'tag-dropdown-item create';
    addNew.setAttribute('role', 'option');
    addNew.textContent = '+ Add New';
    addNew._activate = () => {
      closeCombo(id);
      prompt_(c.kind.promptLabel, '', async name => {
        if (!name) return;
        await c.kind.add(name);
        setCombo(id, name);
      });
    };
    addNew.addEventListener('click', addNew._activate);
    dd.appendChild(addNew);
  }

  const none = document.createElement('div');
  none.className = 'tag-dropdown-item' + (c.value ? '' : ' selected');
  none.setAttribute('role', 'option');
  none.textContent = '— None —';
  none._activate = () => { setCombo(id, ''); closeCombo(id); };
  none.addEventListener('click', none._activate);
  dd.appendChild(none);

  // The current value is merged in even when it is no longer a listed option,
  // so opening an older entry never silently drops what it already had.
  const options = [...c.kind.getOptions()];
  if (c.value && !options.includes(c.value)) options.push(c.value);

  options.sort(byName).forEach(name => {
    const item = document.createElement('div');
    item.className = 'tag-dropdown-item' + (name === c.value ? ' selected' : '');
    item.setAttribute('role', 'option');
    const label = document.createElement('span');
    label.textContent = name;
    item.appendChild(label);
    item._activate = () => { setCombo(id, name); closeCombo(id); };
    item.addEventListener('click', item._activate);

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
  del.setAttribute('aria-label', `Delete "${name}"`);
  del.addEventListener('click', e => {
    e.stopPropagation();
    if (beforeConfirm) beforeConfirm();
    confirmOptionDelete(name, used, () => remove(name));
  });
  return del;
}

// Shared by every place an option can be deleted (combo dropdowns, the Style
// Tags dropdown, and the Settings lists) so the warning is written once.
export function confirmOptionDelete(name, used, run) {
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
export async function ensureType(value) {
  const val = (value || '').trim();
  if (!val || state.types.some(t => t.toLowerCase() === val.toLowerCase())) return;
  state.types.push(val);
  try { await api.post('/api/types', { name: val }); } catch { /* already exists server-side */ }
  syncOptionUI();
}

export async function ensureFoundVia(value) {
  const val = (value || '').trim();
  if (!val || state.foundVia.some(t => t.toLowerCase() === val.toLowerCase())) return;
  state.foundVia.push(val);
  try { await api.post('/api/found-via', { name: val }); } catch { /* already exists server-side */ }
  syncOptionUI();
}

export async function deleteTypeOption(name) {
  const res = await api.del(`/api/types/${encodeURIComponent(name)}`);
  state.types = res.types;
  state.entries.forEach(e => { if (e.type === name) e.type = null; });
  if (state.filters.type === name) state.filters.type = '';
  syncOptionUI(name);
  renderBrowse();
}

export async function renameTypeOption(oldName, newName) {
  const res = await api.put(`/api/types/${encodeURIComponent(oldName)}`, { newName });
  state.types = res.types;
  state.entries.forEach(e => { if (e.type === oldName) e.type = newName; });
  if (state.filters.type === oldName) state.filters.type = newName;
  Object.keys(combos).forEach(id => { if (combos[id].value === oldName) setCombo(id, newName); });
  syncOptionUI();
  renderBrowse();
}

export async function deleteFoundViaOption(name) {
  const res = await api.del(`/api/found-via/${encodeURIComponent(name)}`);
  state.foundVia = res.foundVia;
  state.entries.forEach(e => { if (e.found_via === name) e.found_via = ''; });
  syncOptionUI(name);
}

export async function renameFoundViaOption(oldName, newName) {
  const res = await api.put(`/api/found-via/${encodeURIComponent(oldName)}`, { newName });
  state.foundVia = res.foundVia;
  state.entries.forEach(e => { if (e.found_via === oldName) e.found_via = newName; });
  Object.keys(combos).forEach(id => { if (combos[id].value === oldName) setCombo(id, newName); });
  syncOptionUI();
}

export function tagUsage(name) { return state.entries.filter(e => e.style_tags.includes(name)).length; }

export async function deleteTagOption(name) {
  const res = await api.del(`/api/tags/${encodeURIComponent(name)}`);
  state.tags = res.tags;
  afterTagsChanged();
}

export async function renameTagOption(oldName, newName) {
  const res = await api.put(`/api/tags/${encodeURIComponent(oldName)}`, { newName });
  state.tags = res.tags;
  state.entries.forEach(e => { e.style_tags = e.style_tags.map(t => t === oldName ? newName : t); });
  state.filters.tags = state.filters.tags.map(t => t === oldName ? newName : t);
  [state.formTags, state.detailTags].forEach(arr => {
    const i = arr.indexOf(oldName);
    if (i !== -1) arr[i] = newName;
  });
  afterTagsChanged(false);
}

// After tags were deleted or merged: reload entries from the server (it did the
// rewriting) and drop references to tags that no longer exist.
export async function afterTagsChanged(reload = true) {
  if (reload) state.entries = await api.get('/api/entries');
  state.filters.tags = state.filters.tags.filter(t => state.tags.includes(t));
  [state.formTags, state.detailTags].forEach(arr => {
    const kept = arr.filter(t => state.tags.includes(t));
    arr.splice(0, arr.length, ...kept);
  });
  renderFormTagPills();
  renderDetailTagPills();
  renderTagList();
  renderBrowse();
}

// ═══════════════════════════════════════════ TAG INPUT WIDGET ══
// Adds `raw` to a selection, reusing an existing tag whose name differs only in
// case, and registering a brand-new one. Returns true when the selection changed.
function addTag(tagsArr, raw) {
  const val = raw.trim();
  if (!val) return false;
  let tag = state.tags.find(t => t.toLowerCase() === val.toLowerCase());
  if (!tag) {
    tag = val;
    state.tags.push(tag);
    api.post('/api/tags', { name: tag }).catch(() => {});
  }
  if (tagsArr.includes(tag)) return false;
  tagsArr.push(tag);
  return true;
}

export function setupTagInput(inputId, dropdownId, tagsArr, onUpdate) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  input.addEventListener('input', () => renderTagDropdown(input, dropdown, tagsArr, onUpdate));
  input.addEventListener('focus', () => renderTagDropdown(input, dropdown, tagsArr, onUpdate));
  input.addEventListener('keydown', e => {
    // Up/Down highlights a row; Enter on a highlighted row activates it
    // instead of falling through to the quick-add-typed-text behavior below.
    if (navigateDropdown(e, dropdown)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (addTag(tagsArr, input.value)) {
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
    .sort(byName);
  dropdown.innerHTML = '';
  dropdown.setAttribute('role', 'listbox');

  // "+ Add New" is always pinned first; typed text (if any) is offered as the default name.
  const addNew = document.createElement('div');
  addNew.className = 'tag-dropdown-item create';
  addNew.setAttribute('role', 'option');
  addNew.textContent = '+ Add New';
  addNew._activate = () => {
    dropdown.style.display = 'none';
    prompt_('New style tag', input.value.trim(), val => {
      addTag(tagsArr, val);
      input.value = '';
      onUpdate();
    });
  };
  addNew.addEventListener('mousedown', e => { e.preventDefault(); addNew._activate(); });
  dropdown.appendChild(addNew);

  available.forEach(tag => {
    const item = document.createElement('div');
    item.className = 'tag-dropdown-item';
    item.setAttribute('role', 'option');
    const label = document.createElement('span');
    label.textContent = tag;
    item.appendChild(label);
    item._activate = () => {
      tagsArr.push(tag);
      input.value = '';
      dropdown.style.display = 'none';
      onUpdate();
    };
    item.addEventListener('mousedown', e => { e.preventDefault(); item._activate(); });

    const del = optionDeleteBtn(tag, tagUsage(tag), deleteTagOption, () => { dropdown.style.display = 'none'; });
    // The row itself selects on mousedown, so the ✕ must swallow that too.
    del.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    item.appendChild(del);

    dropdown.appendChild(item);
  });

  dropdown.style.display = '';
}

// Pills for the selected tags. Built with DOM calls (not innerHTML) so a tag
// containing quotes or markup can't break out of the aria-label attribute.
export function renderTagPills(container, tags, onRemove) {
  container.innerHTML = '';
  tags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.append(tag);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '✕';
    btn.setAttribute('aria-label', `Remove ${tag}`);
    btn.addEventListener('click', () => onRemove(tag));
    pill.appendChild(btn);
    container.appendChild(pill);
  });
}
