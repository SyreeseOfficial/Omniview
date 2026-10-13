// The Add Entry form (auto-fill, duplicate check, screenshot queue) and the
// entry detail modal (screenshot carousel, palette, prev/next, save).

import { state, safeHref, isHttpUrl, faviconImg, colorName } from './state.js';
import { api } from './api.js';
import {
  confirm_, toastSuccess, toastError, openModalOverlay, closeModalOverlay, isOpen, openLightbox, setLightboxSrc
} from './modals.js';
import { comboValue, setCombo, setupTagInput, renderTagPills } from './options.js';
import { renderBrowse, deleteEntriesWithUndo, toggleFavorite, recordRecent } from './browse.js';
import { navigate } from './main.js';

const $ = id => document.getElementById(id);
const MAX_SCREENSHOTS = 10; // keep in step with the server

// ═══════════════════════════════════════════ ADD FORM ══
let formSnapshot = null;
let lastCheckedUrl = '';
let dupeEntry = null;

export function clearFormSnapshot() { formSnapshot = null; }

// Captured right after the form is populated; compared against on every
// navigation attempt so edits aren't discarded without a prompt.
function captureFormSnapshot() {
  return JSON.stringify({
    title: $('f-title').value,
    url: $('f-url').value,
    type: comboValue('f-type'),
    color: comboValue('f-color'),
    foundVia: comboValue('f-found-via'),
    note: $('f-note').value,
    favorite: $('f-favorite').checked,
    tags: [...state.formTags],
    boards: [...state.formBoards],
    pending: state.pending.length
  });
}

export function isFormDirty() {
  return state.view === 'add' && formSnapshot !== null && captureFormSnapshot() !== formSnapshot;
}

export function openAddForm() {
  $('f-title').value = '';
  $('f-url').value = '';
  setCombo('f-type', '');
  setCombo('f-color', '');
  setCombo('f-found-via', '');
  $('f-note').value = '';
  $('f-favorite').checked = false;
  showDuplicate(null);
  $('unfurl-status').style.display = 'none';
  lastCheckedUrl = '';
  state.pageInfo = null;
  state.allowDuplicate = false;

  // Mutate in place (not `state.formTags = [...]`) so the array reference
  // captured by setupTagInput's closures stays valid.
  state.formTags.length = 0;
  state.formBoards = new Set();
  clearPending();

  renderFormTagPills();
  updateFormBoardChips();
  formSnapshot = captureFormSnapshot();
}

// ─── Screenshot queue (uploaded once the entry is saved) ─────────────────────
function clearPending() {
  state.pending.forEach(p => p.file && URL.revokeObjectURL(p.preview));
  state.pending.length = 0;
  renderPending();
}

export function addPendingFiles(files) {
  const images = [...files].filter(f => f.type.startsWith('image/'));
  for (const file of images) {
    if (state.pending.length >= MAX_SCREENSHOTS) { toastError(`At most ${MAX_SCREENSHOTS} screenshots per entry.`); break; }
    state.pending.push({ file, preview: URL.createObjectURL(file) });
  }
  renderPending();
}

function renderPending() {
  const box = $('pending-shots');
  box.innerHTML = '';
  box.style.display = state.pending.length ? '' : 'none';
  $('drop-zone-inner').style.display = state.pending.length ? 'none' : '';

  state.pending.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'pending-shot';
    const img = document.createElement('img');
    img.src = p.preview;
    img.alt = `Screenshot ${i + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Remove screenshot ${i + 1}`);
    remove.addEventListener('click', () => {
      if (p.file) URL.revokeObjectURL(p.preview);
      state.pending.splice(i, 1);
      renderPending();
    });
    item.append(img, remove);
    box.appendChild(item);
  });

  const more = document.createElement('label');
  more.className = 'pending-add';
  more.htmlFor = 'screenshot-file';
  more.title = 'Add another screenshot';
  more.textContent = '+';
  box.appendChild(more);
}

// ─── Duplicate check + auto-fill ─────────────────────────────────────────────
function showDuplicate(entry) {
  dupeEntry = entry;
  $('dupe-warning').style.display = entry ? '' : 'none';
}

async function checkDuplicate(url) {
  try {
    const { duplicate } = await api.get(`/api/duplicate?url=${encodeURIComponent(url)}`);
    if ($('f-url').value.trim() === url) showDuplicate(duplicate);
  } catch { /* the save itself re-checks */ }
}

// Fills title, color (from the page's theme-color), favicon, and the og:image as
// a queued screenshot — only into fields/slots the user hasn't already used.
async function autofill(url) {
  const status = $('unfurl-status');
  status.style.display = '';
  status.textContent = 'Fetching page info…';
  try {
    const info = await api.get(`/api/unfurl?url=${encodeURIComponent(url)}`);
    if ($('f-url').value.trim() !== url) return;
    state.pageInfo = { favicon: info.favicon, forUrl: url };
    if (info.title && !$('f-title').value.trim()) $('f-title').value = info.title;
    if (info.themeColor && !comboValue('f-color')) setCombo('f-color', colorName(info.themeColor));
    if (info.image && !state.pending.length) {
      state.pending.push({ url: info.image, preview: info.image });
      renderPending();
    }
    status.textContent = 'Filled in from the page.';
  } catch (err) {
    if ($('f-url').value.trim() === url) status.textContent = `Couldn't read the page (${err.message}).`;
  }
}

function onUrlEntered() {
  const url = $('f-url').value.trim();
  if (url === lastCheckedUrl) return;
  lastCheckedUrl = url;
  state.allowDuplicate = false;
  showDuplicate(null);
  $('unfurl-status').style.display = 'none';
  if (!isHttpUrl(url)) return;
  checkDuplicate(url);
  autofill(url);
}

export function setupAddForm() {
  // Drop zone
  const zone = $('drop-zone');
  const fileInput = $('screenshot-file');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); // also tells the window-level drop handler this one is taken
    zone.classList.remove('drag-over');
    addPendingFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => {
    addPendingFiles(fileInput.files);
    fileInput.value = '';
  });

  // URL: duplicate check + auto-fill on blur/paste
  const urlInput = $('f-url');
  urlInput.addEventListener('blur', onUrlEntered);
  urlInput.addEventListener('paste', () => setTimeout(onUrlEntered, 0));
  $('dupe-open').addEventListener('click', () => { if (dupeEntry) openDetail(dupeEntry.id); });
  $('dupe-add').addEventListener('click', () => { state.allowDuplicate = true; showDuplicate(null); });

  // Tag search
  setupTagInput('tag-search', 'tag-dropdown', state.formTags, renderFormTagPills);

  // Cancel
  $('form-cancel').addEventListener('click', () => {
    formSnapshot = null;
    navigate('browse');
  });

  // Submit
  $('entry-form').addEventListener('submit', async e => {
    e.preventDefault();
    const url = $('f-url').value.trim();
    if (!url) return;

    const btn = $('form-submit');
    btn.disabled = true;
    try {
      const payload = {
        title: $('f-title').value.trim(),
        url,
        type: comboValue('f-type') || null,
        color: comboValue('f-color') || null,
        found_via: comboValue('f-found-via'),
        note: $('f-note').value.trim(),
        favorite: $('f-favorite').checked,
        style_tags: state.formTags,
        boards: [...state.formBoards],
        force: state.allowDuplicate
      };
      if (state.pageInfo && state.pageInfo.forUrl === url && state.pageInfo.favicon) payload.favicon = state.pageInfo.favicon;

      let entry;
      try {
        entry = (await api.post('/api/entries', payload)).entry;
      } catch (err) {
        if (err.status !== 409) throw err;
        showDuplicate(err.data.duplicate);
        toastError('That URL is already saved. Open it, or choose "Add anyway".');
        return;
      }

      for (const p of state.pending) {
        try {
          if (p.file) await api.uploadScreenshot(entry.id, p.file);
          else await api.post(`/api/entries/${entry.id}/screenshot-url`, { url: p.url });
        } catch (err) {
          toastError(`Screenshot not added: ${err.message}`);
        }
      }
      // Re-read so the entry has its cover image and palette.
      state.entries.unshift(state.pending.length ? await api.get(`/api/entries/${entry.id}`) : entry);

      clearPending();
      formSnapshot = null;
      navigate('browse');
      toastSuccess('Entry added.');
    } catch (err) {
      toastError(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

export function renderFormTagPills() {
  renderTagPills($('tag-pills'), state.formTags, tag => {
    const i = state.formTags.indexOf(tag);
    if (i !== -1) state.formTags.splice(i, 1);
    renderFormTagPills();
  });
}

// A row of toggle chips, one per board, bound to a Set of selected board ids.
function renderBoardChips(wrap, selected, emptyText) {
  wrap.innerHTML = '';
  if (state.boards.length === 0) {
    wrap.innerHTML = `<span style="font-size:.75rem;color:var(--text-3)">${emptyText}</span>`;
    return;
  }
  state.boards.forEach(b => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'board-chip-toggle' + (selected.has(b.id) ? ' selected' : '');
    chip.textContent = b.name;
    chip.setAttribute('aria-pressed', String(selected.has(b.id)));
    chip.addEventListener('click', () => {
      if (selected.has(b.id)) selected.delete(b.id);
      else selected.add(b.id);
      chip.classList.toggle('selected', selected.has(b.id));
      chip.setAttribute('aria-pressed', String(selected.has(b.id)));
    });
    wrap.appendChild(chip);
  });
}

export function updateFormBoardChips() {
  renderBoardChips($('form-boards'), state.formBoards, 'No boards yet — create one in the Boards view.');
}

// ═══════════════════════════════════════════ DETAIL MODAL ══
let detailBaseline = '';

function detailSnapshot() {
  return JSON.stringify({
    title: $('detail-title').value,
    type: comboValue('detail-type'),
    color: comboValue('detail-color'),
    foundVia: comboValue('detail-found-via'),
    note: $('detail-note').value,
    tags: [...state.detailTags],
    boards: [...state.detailBoards]
  });
}

// Swaps in the fresh copy of an entry after the server changed it.
function replaceEntry(fresh) {
  const idx = state.entries.findIndex(e => e.id === fresh.id);
  if (idx !== -1) state.entries[idx] = fresh;
  if (state.detailEntry && state.detailEntry.id === fresh.id) state.detailEntry = fresh;
}

// ─── Screenshot carousel ─────────────────────────────────────────────────────
function renderDetailShots() {
  const entry = state.detailEntry;
  const shots = entry.screenshots;
  state.detailShot = Math.max(0, Math.min(state.detailShot, shots.length - 1));
  const img = $('detail-screenshot');

  if (shots.length) {
    img.src = `/uploads/${shots[state.detailShot]}`;
    img.alt = entry.title || entry.url;
  } else {
    img.removeAttribute('src');
  }
  img.style.display = shots.length ? '' : 'none';
  $('detail-no-screenshot').style.display = shots.length ? 'none' : '';
  $('shot-prev').style.display = $('shot-next').style.display = shots.length > 1 ? '' : 'none';
  $('shot-count').style.display = shots.length > 1 ? '' : 'none';
  $('shot-count').textContent = `${state.detailShot + 1} / ${shots.length}`;
  $('detail-remove-shot').style.display = shots.length ? '' : 'none';
}

// Moves to the next/previous screenshot (wrapping); keeps an open lightbox in step.
export function stepShot(delta) {
  const shots = state.detailEntry ? state.detailEntry.screenshots : [];
  if (shots.length < 2) return;
  state.detailShot = (state.detailShot + delta + shots.length) % shots.length;
  renderDetailShots();
  if (isOpen('lightbox-overlay')) setLightboxSrc(`/uploads/${shots[state.detailShot]}`);
}

function renderPalette(entry) {
  const wrap = $('detail-palette');
  wrap.innerHTML = '';
  wrap.parentElement.style.display = entry.palette.length ? '' : 'none';
  entry.palette.forEach(hex => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'palette-swatch';
    sw.style.background = hex;
    sw.title = `${hex} — click to copy`;
    sw.setAttribute('aria-label', `Copy ${hex}`);
    sw.addEventListener('click', () => {
      navigator.clipboard.writeText(hex).then(() => toastSuccess(`Copied ${hex}`), () => toastError('Could not copy.'));
    });
    wrap.appendChild(sw);
  });
}

export async function applyDetailScreenshots(files) {
  const entry = state.detailEntry;
  if (!entry) return;
  try {
    for (const file of files) await api.uploadScreenshot(entry.id, file);
  } catch (err) {
    toastError(err.message);
  }
  const fresh = await api.get(`/api/entries/${entry.id}`);
  replaceEntry(fresh);
  if (state.detailEntry && state.detailEntry.id === fresh.id) {
    state.detailShot = fresh.screenshots.length - 1;
    renderDetailShots();
    renderPalette(fresh);
  }
  renderBrowse();
}

export function setupDetailModal() {
  $('detail-close').addEventListener('click', closeDetail);
  $('detail-overlay').addEventListener('click', e => {
    if (e.target === $('detail-overlay')) closeDetail();
  });
  $('detail-prev').addEventListener('click', () => stepDetail(-1));
  $('detail-next').addEventListener('click', () => stepDetail(1));

  $('detail-fav').addEventListener('click', async () => {
    if (!state.detailEntry) return;
    await toggleFavorite(state.detailEntry.id);
    state.detailEntry = state.entries.find(e => e.id === state.detailEntry.id);
    $('detail-fav').classList.toggle('is-fav', !!state.detailEntry?.favorite);
    $('detail-fav').setAttribute('aria-pressed', String(!!state.detailEntry?.favorite));
  });

  // Screenshots in detail
  $('shot-prev').addEventListener('click', () => stepShot(-1));
  $('shot-next').addEventListener('click', () => stepShot(1));
  $('detail-screenshot').addEventListener('click', () => {
    const shots = state.detailEntry.screenshots;
    if (shots.length) openLightbox(`/uploads/${shots[state.detailShot]}`);
  });
  $('detail-screenshot-file').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await applyDetailScreenshots(files);
  });
  $('detail-remove-shot').addEventListener('click', () => {
    const entry = state.detailEntry;
    if (!entry || !entry.screenshots.length) return;
    const file = entry.screenshots[state.detailShot];
    confirm_('Remove this screenshot?', async () => {
      try {
        const fresh = await api.del(`/api/entries/${entry.id}/screenshots/${encodeURIComponent(file)}`);
        replaceEntry(fresh);
        if (state.detailEntry && state.detailEntry.id === fresh.id) { renderDetailShots(); renderPalette(fresh); }
        renderBrowse();
      } catch (err) { toastError(err.message); }
    }, 'Remove');
  });

  // Tag input in detail
  setupTagInput('detail-tag-search', 'detail-tag-dropdown', state.detailTags, renderDetailTagPills);

  $('detail-save').addEventListener('click', async () => {
    if (!state.detailEntry) return;
    const payload = {
      title: $('detail-title').value.trim(),
      url: state.detailEntry.url,
      type: comboValue('detail-type') || null,
      color: comboValue('detail-color') || null,
      found_via: comboValue('detail-found-via'),
      note: $('detail-note').value.trim(),
      favorite: state.detailEntry.favorite,
      style_tags: state.detailTags,
      boards: [...state.detailBoards]
    };
    try {
      replaceEntry(await api.put(`/api/entries/${state.detailEntry.id}`, payload));
    } catch (err) {
      toastError(err.message);
      return;
    }
    closeDetail();
    renderBrowse();
    toastSuccess('Entry updated.');
  });

  $('detail-delete').addEventListener('click', () => {
    if (!state.detailEntry) return;
    const entry = state.detailEntry;
    confirm_('Delete this entry?', () => {
      closeDetail();
      deleteEntriesWithUndo([entry.id]);
    });
  });
}

export function openDetail(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  if (!isOpen('detail-overlay')) {
    openModalOverlay('detail-overlay');
    document.body.style.overflow = 'hidden';
  }
  loadDetail(entry);
}

// Fills the (already open) modal with an entry.
function loadDetail(entry) {
  state.detailEntry = entry;
  recordRecent(entry.id);
  // Mutate in place — see the comment in openAddForm for why reassigning breaks the tag dropdown.
  state.detailTags.length = 0;
  state.detailTags.push(...entry.style_tags);
  state.detailBoards = new Set(entry.boards);

  const link = $('detail-url');
  const href = safeHref(entry.url);
  if (href) link.href = href; else link.removeAttribute('href');
  link.textContent = entry.url;
  const icon = $('detail-favicon');
  icon.innerHTML = '';
  if (entry.favicon) icon.appendChild(faviconImg(entry.favicon));

  $('detail-fav').classList.toggle('is-fav', !!entry.favorite);
  $('detail-fav').setAttribute('aria-pressed', String(!!entry.favorite));
  $('detail-title').value = entry.title;
  setCombo('detail-type', entry.type || '');
  setCombo('detail-color', entry.color || '');
  setCombo('detail-found-via', entry.found_via);
  $('detail-note').value = entry.note;
  $('detail-date').textContent = new Date(entry.date_added).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  state.detailShot = 0;
  renderDetailShots();
  renderPalette(entry);
  renderDetailTagPills();
  renderBoardChips($('detail-boards'), state.detailBoards, 'No boards yet.');

  const canStep = state.navIds.length > 1 && state.navIds.includes(entry.id);
  $('detail-prev').style.display = $('detail-next').style.display = canStep ? '' : 'none';
  detailBaseline = detailSnapshot();
}

// Previous/next entry in the list the modal was opened from (wrapping).
export function stepDetail(delta) {
  const entry = state.detailEntry;
  const ids = state.navIds;
  const i = entry ? ids.indexOf(entry.id) : -1;
  if (i === -1 || ids.length < 2) return;
  const next = state.entries.find(e => e.id === ids[(i + delta + ids.length) % ids.length]);
  if (!next) return;
  if (detailSnapshot() === detailBaseline) loadDetail(next);
  else confirm_('Discard unsaved changes to this entry?', () => loadDetail(next), 'Discard');
}

export function closeDetail() {
  closeModalOverlay('detail-overlay');
  document.body.style.overflow = '';
  state.detailEntry = null;
}

export function renderDetailTagPills() {
  renderTagPills($('detail-tag-pills'), state.detailTags, tag => {
    const i = state.detailTags.indexOf(tag);
    if (i !== -1) state.detailTags.splice(i, 1);
    renderDetailTagPills();
  });
}
