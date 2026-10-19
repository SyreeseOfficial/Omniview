// Settings view: managed option lists (tags with merge/bulk delete, types,
// found-via), the autofill report, trash, and storage stats and cleanup.

import { state, byName, SPACES, titleOf } from './state.js';
import { api } from './api.js';
import { confirm_, prompt_, toastSuccess, toastError } from './modals.js';
import {
  ensureType, ensureFoundVia, tagUsage, typeUsage, foundViaUsage, confirmOptionDelete,
  renameTagOption, deleteTagOption, renameTypeOption, deleteTypeOption, renameFoundViaOption, deleteFoundViaOption,
  afterTagsChanged
} from './options.js';
import { similarTag, timeAgo } from './lib.js';
import { reportLines } from './autofill.js';
import { renderBrowse } from './browse.js';
import { loadAll } from './main.js';

const $ = id => document.getElementById(id);

const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`;

const selectedTags = new Set(); // tags ticked for merge / bulk delete
let tagSort = 'name';           // 'name' | 'count'

export function setupSettings() {
  $('add-tag-btn').addEventListener('click', async () => {
    const input = $('new-tag-input');
    const name = input.value.trim();
    if (!name) return;
    const create = async () => {
      try {
        const res = await api.post('/api/tags', { name });
        state.tags = res.tags;
        input.value = '';
        renderTagList();
        renderBrowse();
      } catch (err) { toastError(err.message); }
    };
    const near = state.tags.some(t => t.toLowerCase() === name.toLowerCase()) ? null : similarTag(name, state.tags);
    if (near) confirm_(`"${name}" looks like your existing tag "${near}". Create it anyway?`, create, 'Create anyway');
    else create();
  });
  $('new-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('add-tag-btn').click();
  });

  $('tag-sort').addEventListener('change', e => { tagSort = e.target.value; renderTagList(); });
  $('tag-merge-btn').addEventListener('click', mergeSelectedTags);
  $('tag-bulk-delete-btn').addEventListener('click', deleteSelectedTags);

  setupOptionAdder('new-type-input', 'add-type-btn', () => state.types, ensureType, renderTypeList);
  setupOptionAdder('new-found-via-input', 'add-found-via-btn', () => state.foundVia, ensureFoundVia, renderFoundViaList);

  $('trash-empty-btn').addEventListener('click', () => {
    confirm_('Permanently delete everything in the trash, screenshots included? This cannot be undone.', async () => {
      try {
        await api.del('/api/trash');
        renderTrash();
        renderStorage();
      } catch (err) { toastError(err.message); }
    }, 'Empty trash');
  });

  $('cleanup-btn').addEventListener('click', async () => {
    try {
      const { removed, bytes } = await api.get('/api/cleanup');
      if (!removed) return toastSuccess('No unused files found.');
      confirm_(`${removed} unused ${removed === 1 ? 'file' : 'files'} (${mb(bytes)}) will be deleted. Continue?`, async () => {
        try {
          await api.post('/api/cleanup');
          toastSuccess(`Removed ${removed} unused ${removed === 1 ? 'file' : 'files'} (${mb(bytes)}).`);
          renderStorage();
        } catch (err) { toastError(err.message); }
      }, 'Delete');
    } catch (err) { toastError(err.message); }
  });

  $('optimize-btn').addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const { converted, saved } = await api.post('/api/optimize');
      toastSuccess(converted ? `Optimised ${converted} ${converted === 1 ? 'file' : 'files'}, saved ${mb(saved)}.` : 'Nothing to optimise.');
      if (converted) { await loadAll(); renderBrowse(); renderStorage(); }
    } catch (err) { toastError(err.message); }
    e.target.disabled = false;
  });

  $('autofill-report-clear').addEventListener('click', () => {
    try { localStorage.removeItem(reportKey()); } catch { /* storage unavailable */ }
    renderAutofillReport();
  });
}

const reportKey = () => `omniview-autofill-report-${state.space}`;

function renderAutofillReport() {
  let report = {};
  try { report = JSON.parse(localStorage.getItem(reportKey())) || {}; } catch { /* unreadable: start over */ }
  const lines = reportLines(report);
  $('autofill-report').replaceChildren(...(lines.length
    ? lines.map(text => Object.assign(document.createElement('div'), { className: 'tag-list-item', textContent: text }))
    : [Object.assign(document.createElement('div'), { className: 'tag-list-empty', textContent: 'Nothing missing so far.' })]));
  $('autofill-report-clear').disabled = !lines.length;
}

export function renderSettings() {
  renderTagList();
  renderTypeList();
  renderFoundViaList();
  renderAutofillReport();
  renderTrash();
  renderStorage();
  // Sync theme buttons
  const t = document.documentElement.dataset.theme;
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.t === t));
}

// ─── Trash ───────────────────────────────────────────────────────────────────
async function renderTrash() {
  const items = await api.get('/api/trash').catch(() => []);
  $('trash-count').textContent = items.length;
  $('trash-empty-btn').disabled = !items.length;
  const list = $('trash-list');
  list.innerHTML = '';
  if (!items.length) list.innerHTML = '<div class="tag-list-empty">Trash is empty.</div>';
  items.forEach(e => {
    const item = document.createElement('div');
    item.className = 'tag-list-item';
    const title = document.createElement('span');
    title.className = 'tag-list-title';
    title.textContent = titleOf(e);
    const hint = document.createElement('small');
    hint.className = 'tag-list-use';
    hint.textContent = `deleted ${timeAgo(e.deleted_at)} · ${e.days_left} ${e.days_left === 1 ? 'day' : 'days'} left`;

    const restore = document.createElement('button');
    restore.className = 'tag-action-btn';
    restore.textContent = 'Restore';
    restore.addEventListener('click', async () => {
      try {
        await api.post(`/api/trash/${e.id}/restore`);
        await loadAll();
        renderBrowse();
        renderSettings();
        toastSuccess('Entry restored.');
      } catch (err) { toastError(err.message); }
    });
    const purge = document.createElement('button');
    purge.className = 'tag-action-btn del';
    purge.textContent = 'Delete forever';
    purge.addEventListener('click', () => confirm_(`Permanently delete "${titleOf(e)}" and its screenshots? This cannot be undone.`, async () => {
      try {
        await api.del(`/api/trash/${e.id}`);
        renderTrash();
        renderStorage();
      } catch (err) { toastError(err.message); }
    }, 'Delete forever'));

    const actions = document.createElement('div');
    actions.className = 'tag-list-actions';
    actions.append(restore, purge);
    item.append(title, hint, actions);
    list.appendChild(item);
  });
}

// ─── Storage ─────────────────────────────────────────────────────────────────
async function renderStorage() {
  const s = await api.get('/api/storage').catch(() => null);
  if (!s) return;
  const n = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const rows = [
    ...Object.entries(s.spaces).map(([name, c]) => [`${SPACES[name]} library`, `${c.entries} ${c.entries === 1 ? 'entry' : 'entries'}${c.trash ? `, ${c.trash} in trash` : ''}${c.brokenImages ? `, ${n(c.brokenImages, 'broken image')} (the file is missing from uploads)` : ''}`]),
    ['Uploads', `${n(s.uploads.files, 'file')}, ${mb(s.uploads.bytes)}`],
    ['Thumbnails', `${n(s.thumbs.files, 'file')}, ${mb(s.thumbs.bytes)}`],
    ['Backups', `${n(s.backups.files, 'file')}, ${mb(s.backups.bytes)}`],
    ['Data folder', s.dataDir],
    ['Uploads folder', s.uploadsDir]
  ];
  const dl = $('storage-stats');
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
}

// ─── Tags: merge + bulk delete ───────────────────────────────────────────────
function updateTagToolbar() {
  const n = selectedTags.size;
  $('tag-merge-btn').disabled = n < 2;
  $('tag-bulk-delete-btn').disabled = n < 1;
  $('tag-bulk-delete-btn').textContent = n ? `Delete selected (${n})` : 'Delete selected';
}

function mergeSelectedTags() {
  const names = [...selectedTags];
  prompt_(`Merge ${names.length} tags into (existing or new name):`, names[0], async target => {
    if (!target) return;
    try {
      const res = await api.post('/api/tags/merge', { sources: names, target });
      state.tags = res.tags;
      const merged = state.tags.find(t => t.toLowerCase() === target.toLowerCase());
      // Selections still being edited elsewhere follow the merge instead of losing the tag.
      state.filters.tags = remap(state.filters.tags, names, merged);
      [state.formTags, state.detailTags].forEach(arr => arr.splice(0, arr.length, ...remap(arr, names, merged)));
      selectedTags.clear();
      await afterTagsChanged();
      toastSuccess(`Merged into "${merged}".`);
    } catch (err) { toastError(err.message); }
  });
}

function remap(list, sources, target) {
  return list.some(t => sources.includes(t)) ? [...list.filter(t => !sources.includes(t)), target] : list;
}

function deleteSelectedTags() {
  const names = [...selectedTags];
  const used = state.entries.filter(e => e.style_tags.some(t => names.includes(t))).length;
  confirm_(`Delete ${names.length} ${names.length === 1 ? 'tag' : 'tags'}? They will be removed from ${used} ${used === 1 ? 'entry' : 'entries'}.`, async () => {
    try {
      const res = await api.post('/api/tags/bulk-delete', { names });
      state.tags = res.tags;
      selectedTags.clear();
      await afterTagsChanged();
    } catch (err) { toastError(err.message); }
  });
}

export function renderTagList() {
  [...selectedTags].forEach(t => { if (!state.tags.includes(t)) selectedTags.delete(t); });
  renderManagedList('tag-list', 'tag-count', state.tags, {
    usage: tagUsage,
    onRename: renameTagOption,
    onDelete: deleteTagOption,
    sort: tagSort,
    selected: selectedTags,
    onSelect: updateTagToolbar
  });
  updateTagToolbar();
}

function setupOptionAdder(inputId, buttonId, getOptions, ensureFn, onAdded) {
  const input = $(inputId);
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    if (getOptions().some(o => o.toLowerCase() === name.toLowerCase())) { toastError('That option already exists.'); return; }
    await ensureFn(name);
    input.value = '';
    onAdded();
  };
  $(buttonId).addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}

// Rename + delete manager list, shared by all three Settings sections. Each row
// shows how many entries use the option; `opts.selected` adds checkboxes.
function renderManagedList(listId, countId, items, opts) {
  $(countId).textContent = items.length;
  const list = $(listId);
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<div class="tag-list-empty">None yet.</div>';
    return;
  }
  const rows = items.map(name => ({ name, used: opts.usage(name) }));
  rows.sort(opts.sort === 'count' ? (a, b) => b.used - a.used || byName(a.name, b.name) : (a, b) => byName(a.name, b.name));

  rows.forEach(({ name, used }) => {
    const item = document.createElement('div');
    item.className = 'tag-list-item';

    if (opts.selected) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = opts.selected.has(name);
      box.setAttribute('aria-label', `Select ${name}`);
      box.addEventListener('change', () => {
        if (box.checked) opts.selected.add(name); else opts.selected.delete(name);
        opts.onSelect();
      });
      item.appendChild(box);
    }

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    item.appendChild(nameSpan);

    const hint = document.createElement('small');
    hint.className = 'tag-list-use';
    hint.textContent = `${used} ${used === 1 ? 'entry' : 'entries'}`;
    item.appendChild(hint);

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
        if (commit && newName && newName !== name) {
          try { await opts.onRename(name, newName); } catch (err) { toastError(err.message); }
        }
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

export function renderTypeList() {
  renderManagedList('type-list', 'type-count', state.types, {
    usage: typeUsage,
    onRename: renameTypeOption,
    onDelete: deleteTypeOption
  });
}

export function renderFoundViaList() {
  renderManagedList('found-via-list', 'found-via-count', state.foundVia, {
    usage: foundViaUsage,
    onRename: renameFoundViaOption,
    onDelete: deleteFoundViaOption
  });
}
