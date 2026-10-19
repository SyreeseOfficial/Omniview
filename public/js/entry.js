// The Add Entry form (auto-fill, duplicate check, screenshot queue) and the
// entry detail modal (screenshot carousel, palette, prev/next, save).

import { state, config, hasFoundVia, boardLabel, priceOf, safeHref, isHttpUrl, faviconImg, colorName, thumbImg, titleOf, coverOf, PLACEHOLDER_SVG, COLOR_NAMES, escHtml } from './state.js';
import { moreLike, timeAgo, dominantColors } from './lib.js';
import { guessFashionFields, guessFoundVia, applyCorrections, recordCorrections, cleanTitle, recordReport, hostOf } from './autofill.js';
import { api } from './api.js';
import {
  confirm_, toastSuccess, toastError, openModalOverlay, closeModalOverlay, isOpen, openLightbox, setLightboxSrc
} from './modals.js';
import { comboValue, setCombo, setupTagInput, renderTagPills, renderTagSuggestions } from './options.js';
import { renderBrowse, deleteEntriesWithUndo, toggleFavorite, toggleFlag, markVisited, focusCard } from './browse.js';
import { navigate, setTitle } from './main.js';

const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════ ADD FORM ══
let formSnapshot = null;
let lastCheckedUrl = '';
let dupeEntry = null;

// Leaving the form on purpose (saved, cancelled, discarded) also drops its saved draft.
export function clearFormSnapshot() {
  formSnapshot = null;
  store(draftKey(), null);
}

// localStorage can be unavailable or full; none of these are worth failing over.
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
const draftKey = () => `omniview-draft-${state.space}`;
const foundViaKey = () => `omniview-found-via-${state.space}`;
const CORRECTIONS_KEY = 'omniview-corrections';
const reportKey = () => `omniview-autofill-report-${state.space}`;
let formBaseline = '';
let foundViaDefault = '';
let addAnother = false;

const formatSize = n => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function formValues() {
  return {
    title: $('f-title').value,
    brand: comboValue('f-brand'),
    price: $('f-price').value,
    url: $('f-url').value,
    type: comboValue('f-type'),
    color: comboValue('f-color'),
    foundVia: comboValue('f-found-via'),
    note: $('f-note').value,
    favorite: $('f-favorite').checked,
    tags: [...state.formTags],
    boards: [...state.formBoards]
  };
}

// Captured right after the form is populated; compared against on every
// navigation attempt so edits aren't discarded without a prompt.
function captureFormSnapshot() {
  return JSON.stringify({ ...formValues(), pending: state.pending.length });
}

function restoreDraft() {
  const d = load(draftKey(), null);
  if (!d) return;
  $('f-title').value = d.title || '';
  setCombo('f-brand', d.brand);
  $('f-price').value = d.price || '';
  $('f-url').value = d.url || '';
  setCombo('f-type', d.type);
  setCombo('f-color', d.color);
  setCombo('f-found-via', d.foundVia);
  $('f-note').value = d.note || '';
  $('f-favorite').checked = !!d.favorite;
  state.formTags.push(...(d.tags || []));
  state.formBoards = new Set((d.boards || []).filter(id => state.boards.some(b => b.id === id)));
  renderFormTagPills();
  updateFormBoardChips();
  setStatus('Restored your unsaved draft (screenshots are not kept).');
}

export function isFormDirty() {
  return state.view === 'add' && formSnapshot !== null && captureFormSnapshot() !== formSnapshot;
}

// `keep` (Save & add another) carries Type, Found via and boards into the fresh form.
export function openAddForm({ keep, restore = !keep } = {}) {
  $('f-title').value = '';
  setCombo('f-brand', '');
  $('f-price').value = '';
  $('f-url').value = '';
  setCombo('f-type', keep ? keep.type : '');
  setCombo('f-color', '');
  const lastVia = load(foundViaKey(), '');
  foundViaDefault = keep ? keep.foundVia : state.foundVia.includes(lastVia) ? lastVia : '';
  setCombo('f-found-via', foundViaDefault);
  $('f-note').value = '';
  $('f-favorite').checked = false;
  showDuplicate(null);
  showColourway(null);
  $('unfurl-status').style.display = 'none';
  clearAutofillUi();
  lastCheckedUrl = '';
  state.pageInfo = null;
  state.allowDuplicate = false;

  // Mutate in place (not `state.formTags = [...]`) so the array reference
  // captured by setupTagInput's closures stays valid.
  state.formTags.length = 0;
  state.formBoards = new Set(keep && keep.boards);
  clearPending();

  renderFormTagPills();
  updateFormBoardChips();
  formBaseline = JSON.stringify(formValues());
  formSnapshot = captureFormSnapshot();
  if (restore) restoreDraft(); // after the snapshot, so a restored draft counts as unsaved
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
    if (state.pending.length >= config.maxScreenshots) { toastError(`At most ${config.maxScreenshots} screenshots per entry.`); break; }
    state.pending.push({ file, preview: URL.createObjectURL(file) });
  }
  renderPending();
}

// Palette of the first queued file, for the tag suggestions (UI space only; URL images can't be read cross-origin).
let formPalette = [];
async function updateFormPalette() {
  const file = state.space === 'ui' && (state.pending.find(p => p.file) || {}).file;
  formPalette = [];
  if (file) {
    try {
      const bmp = await createImageBitmap(file);
      const ctx = new OffscreenCanvas(48, 48).getContext('2d');
      ctx.drawImage(bmp, 0, 0, 48, 48);
      bmp.close();
      if ((state.pending.find(p => p.file) || {}).file === file) {
        formPalette = dominantColors(ctx.getImageData(0, 0, 48, 48).data);
        // Name the dominant color once a screenshot is attached, unless the field is already filled.
        if (formPalette.length && !comboValue('f-color')) { setCombo('f-color', colorName(formPalette[0])); markAutofilled('f-color'); }
      }
    } catch { /* undecodable: no suggestions */ }
  }
  renderFormTagPills();
}

function renderPending() {
  updateFormPalette();
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
    if (p.file) {
      const size = document.createElement('span');
      size.className = 'pending-size';
      size.textContent = formatSize(p.file.size);
      item.appendChild(size);
    }
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

// Fashion: the same product saved under another colour is a separate URL, so look for the same shop + price + title stem.
let colourwayEntry = null;

function showColourway(entry) {
  colourwayEntry = entry;
  $('colourway-warning').style.display = entry ? '' : 'none';
  if (entry) $('colourway-name').textContent = titleOf(entry);
}

async function checkColourway() {
  const url = $('f-url').value.trim();
  const title = $('f-title').value.trim();
  const price = $('f-price').value.trim();
  if (state.space !== 'fashion' || !isHttpUrl(url) || !title || !price) return showColourway(null);
  try {
    const { colourway } = await api.get(`/api/duplicate?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&price=${encodeURIComponent(price)}`);
    if ($('f-url').value.trim() === url) showColourway(colourway);
  } catch { /* only a hint */ }
}

// Highlights a field the auto-fill filled until the user touches it.
function markAutofilled(id) {
  const group = $(id).closest('.form-group');
  group.classList.add('autofilled');
  const clear = () => group.classList.remove('autofilled');
  group.addEventListener('input', clear, { once: true });
  group.addEventListener('click', clear, { once: true });
}

function clearAutofillUi() {
  document.querySelectorAll('#entry-form .autofilled').forEach(el => el.classList.remove('autofilled'));
  $('unfurl-images').style.display = 'none';
  $('unfurl-images').innerHTML = '';
}

// The line under the URL: what autofill is doing or did. `cancel` shows a Cancel link, `clean` offers the page's own link.
function setStatus(text, { cancel = false, clean = '' } = {}) {
  $('unfurl-status').style.display = '';
  $('unfurl-text').textContent = text;
  $('unfurl-cancel').style.display = cancel ? '' : 'none';
  const btn = $('unfurl-clean');
  btn.style.display = clean ? '' : 'none';
  btn.textContent = clean ? 'Use cleaned link' : '';
  btn.title = clean;
  btn.dataset.url = clean;
}

// Other images found on the page, as thumbnails to click into the screenshot queue.
function renderCandidateImages(images) {
  const box = $('unfurl-images');
  box.innerHTML = '';
  images.forEach(src => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Add this image';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Image from the page';
    img.addEventListener('error', () => btn.remove());
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      if (state.pending.length >= config.maxScreenshots) return toastError(`At most ${config.maxScreenshots} screenshots per entry.`);
      state.pending.push({ url: src, preview: src });
      renderPending();
      btn.remove();
    });
    box.appendChild(btn);
  });
  box.style.display = images.length ? '' : 'none';
}

// The page's own link (canonical / og:url) when it differs from what was pasted, without tracking junk, on the same site.
function cleanedLink(info, url) {
  const strip = u => u.replace(/\/+$/, '');
  return info.canonical && strip(info.canonical) !== strip(url) && hostOf(info.canonical) === hostOf(url) ? info.canonical : '';
}

let unfurlAbort = null;

// Fills title, favicon, and the page's images as queued screenshots. In the UI
// space it also takes the theme-color; in Fashion it takes brand, price, type
// and color. Only fills fields/slots the user hasn't already used.
async function autofill(url) {
  unfurlAbort?.abort();
  const abort = unfurlAbort = new AbortController();
  setStatus('Fetching page info…');
  clearAutofillUi();
  const slow = setTimeout(() => setStatus('Still trying…', { cancel: true }), 3000);
  try {
    const info = await api.get(`/api/unfurl?url=${encodeURIComponent(url)}`, undefined, abort.signal);
    clearTimeout(slow);
    if ($('f-url').value.trim() !== url) return;
    state.pageInfo = { favicon: info.favicon, forUrl: url };
    const filled = [];
    const skipped = [];
    const wrote = {};
    const fill = (label, id, value, isCombo) => {
      if (!value) return;
      if (isCombo ? comboValue(id) : $(id).value.trim()) return;
      if (isCombo) setCombo(id, value); else $(id).value = value;
      markAutofilled(id);
      filled.push(label);
      wrote[label] = value;
    };
    const title = state.space === 'ui' ? cleanTitle(info.title, info.siteName, url) : info.title;
    fill(state.space === 'fashion' ? 'name' : 'title', 'f-title', title);
    let found;
    if (state.space === 'ui') {
      if (info.themeColor) fill('color', 'f-color', colorName(info.themeColor), true);
      found = { title: info.title, color: info.themeColor };
    } else {
      const raw = guessFashionFields(info, url, { entries: state.entries, types: state.types, colors: COLOR_NAMES });
      const guess = applyCorrections(raw, url, load(CORRECTIONS_KEY, {}));
      fill('brand', 'f-brand', guess.brand, true);
      fill('price', 'f-price', guess.price);
      fill('type', 'f-type', guess.type, true);
      fill('color', 'f-color', guess.color, true);
      for (const [field, n] of Object.entries(raw.skipped)) skipped.push(`${field} (${n} matches)`);
      state.pageInfo.guess = { raw, wrote };
      found = { brand: guess.brand, price: guess.price, type: guess.type, color: guess.color };
    }
    store(reportKey(), recordReport(load(reportKey(), {}), url, found));
    const images = info.images || [];
    const queueFirst = images.length && !state.pending.length;
    if (queueFirst) {
      state.pending.push({ url: images[0], preview: images[0] });
      renderPending();
      filled.push('image');
    }
    renderCandidateImages(queueFirst ? images.slice(1) : images);
    const summary = [filled.length && `Filled ${filled.join(', ')}.`, skipped.length && `Skipped ${skipped.join(', ')}.`].filter(Boolean).join(' ');
    setStatus(summary || 'Nothing new to fill in.', { clean: cleanedLink(info, url) });
    checkColourway();
  } catch (err) {
    clearTimeout(slow);
    if (err.name === 'AbortError') {
      if (abort.cancelled) setStatus('Cancelled. Fill the fields in yourself, or paste the link again.');
      return;
    }
    if ($('f-url').value.trim() === url) setStatus(/blocked/.test(err.message) ? `${err.message}.` : `Couldn't read the page (${err.message}).`);
  } finally {
    if (unfurlAbort === abort) unfurlAbort = null;
  }
}

function onUrlEntered() {
  const url = $('f-url').value.trim();
  if (url === lastCheckedUrl) return;
  lastCheckedUrl = url;
  state.allowDuplicate = false;
  showDuplicate(null);
  showColourway(null);
  unfurlAbort?.abort();
  $('unfurl-status').style.display = 'none';
  clearAutofillUi();
  if (!isHttpUrl(url)) return;
  // Found via comes from the host alone, so it works even when the page can't be read.
  const via = hasFoundVia() ? guessFoundVia(url, state.foundVia) : '';
  const cur = comboValue('f-found-via');
  if (via && (!cur || cur === foundViaDefault)) { setCombo('f-found-via', via); markAutofilled('f-found-via'); }
  checkDuplicate(url);
  autofill(url);
}

// A URL pasted outside the form: fills the URL field (when it is still empty) and runs autofill.
export function pasteUrlIntoForm(url) {
  if ($('f-url').value.trim()) return toastError('Finish or discard the current entry first.');
  $('f-url').value = url;
  onUrlEntered();
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
  $('colourway-open').addEventListener('click', () => { if (colourwayEntry) openDetail(colourwayEntry.id); });
  $('f-title').addEventListener('change', checkColourway);
  $('f-price').addEventListener('change', checkColourway);
  $('unfurl-cancel').addEventListener('click', () => { if (unfurlAbort) { unfurlAbort.cancelled = true; unfurlAbort.abort(); } });
  $('unfurl-clean').addEventListener('click', () => {
    const clean = $('unfurl-clean').dataset.url;
    if (!clean) return;
    $('f-url').value = clean;
    lastCheckedUrl = clean;
    if (state.pageInfo) state.pageInfo.forUrl = clean;
    $('unfurl-clean').style.display = 'none';
    checkDuplicate(clean);
    checkColourway();
  });

  $('paste-url').addEventListener('click', async () => {
    let text = '';
    try { text = (await navigator.clipboard.readText()).trim(); } catch { /* permission denied */ }
    if (isHttpUrl(text)) pasteUrlIntoForm(text); else toastError('The clipboard does not hold a URL.');
  });

  // Draft autosave: a crash or closed tab still leaves the half-filled entry behind.
  setInterval(() => {
    if (state.view !== 'add' || formSnapshot === null) return;
    store(draftKey(), JSON.stringify(formValues()) === formBaseline ? null : formValues());
  }, 2000);

  // Tag search
  setupTagInput('tag-search', 'tag-dropdown', state.formTags, renderFormTagPills);

  // Cancel
  $('form-cancel').addEventListener('click', () => {
    clearFormSnapshot();
    navigate('browse');
  });
  $('form-submit-another').addEventListener('click', () => {
    if (!$('entry-form').reportValidity()) return;
    addAnother = true;
    $('entry-form').requestSubmit();
  });

  // Submit
  $('entry-form').addEventListener('submit', async e => {
    e.preventDefault();
    const another = addAnother;
    addAnother = false;
    const url = $('f-url').value.trim();
    if (!url) return;

    const btn = another ? $('form-submit-another') : $('form-submit');
    const btnText = btn.textContent;
    const buttons = [$('form-submit'), $('form-submit-another')];
    buttons.forEach(b => { b.disabled = true; });
    btn.textContent = 'Saving…';
    try {
      const payload = {
        title: $('f-title').value.trim(),
        url,
        type: comboValue('f-type') || null,
        color: comboValue('f-color') || null,
        found_via: comboValue('f-found-via'),
        note: $('f-note').value.trim(),
        favorite: $('f-favorite').checked,
        ...(state.space === 'fashion' && { brand: comboValue('f-brand'), price: $('f-price').value.trim() }),
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

      let n = 0;
      for (const p of state.pending) {
        btn.textContent = `Uploading ${++n} of ${state.pending.length}…`;
        try {
          if (p.file) await api.uploadScreenshot(entry.id, p.file);
          else await api.postScreenshotUrl(entry.id, p.url);
        } catch (err) {
          toastError(`Screenshot not added: ${err.message}`);
        }
      }
      // Re-read so the entry has its cover image and palette.
      state.entries.unshift(state.pending.length ? await api.get(`/api/entries/${entry.id}`) : entry);

      if (payload.found_via) store(foundViaKey(), payload.found_via);
      const pi = state.pageInfo;
      if (pi && pi.guess && pi.forUrl === url) {
        store(CORRECTIONS_KEY, recordCorrections(pi.guess.raw, pi.guess.wrote, { type: payload.type, color: payload.color }, url, load(CORRECTIONS_KEY, {})));
      }

      if (another) {
        const keep = { type: payload.type || '', foundVia: payload.found_via, boards: [...state.formBoards] };
        clearFormSnapshot();
        openAddForm({ keep });
        $('f-url').focus();
        toastSuccess('Entry added. Ready for the next one.');
      } else {
        clearPending();
        clearFormSnapshot();
        navigate('browse');
        toastSuccess('Entry added.');
      }
    } catch (err) {
      toastError(err.message);
    } finally {
      buttons.forEach(b => { b.disabled = false; });
      btn.textContent = btnText;
    }
  });
}

export function renderFormTagPills() {
  renderTagPills($('tag-pills'), state.formTags, tag => {
    const i = state.formTags.indexOf(tag);
    if (i !== -1) state.formTags.splice(i, 1);
    renderFormTagPills();
  });
  renderTagSuggestions($('tag-suggest'), formPalette, state.formTags, renderFormTagPills);
}

// A row of toggle chips, one per board, bound to a Set of selected board ids.
function renderBoardChips(wrap, selected, emptyText) {
  wrap.innerHTML = '';
  if (state.boards.length === 0) {
    wrap.innerHTML = `<span style="font-size:.75rem;color:var(--text-3)">${escHtml(emptyText)}</span>`;
    return;
  }
  state.boards.forEach(b => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'board-chip-toggle' + (selected.has(b.id) ? ' selected' : '') + (b.color ? ' has-color' : '');
    chip.style.setProperty('--board-color', b.color || 'transparent');
    chip.textContent = boardLabel(b);
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
let detailPriceWas = ''; // the price before the last "Refresh price", saved as price_was

function showPriceWas() {
  const el = $('detail-price-was');
  const was = detailPriceWas && detailPriceWas !== $('detail-price').value.trim() ? detailPriceWas : '';
  el.textContent = was ? `was ${was}` : '';
  el.style.display = was ? '' : 'none';
}

// The Bought button reflects the entry and saves straight away, like the heart does.
function syncFlagButtons(entry) {
  const on = !!entry?.bought;
  $('detail-bought').classList.toggle('is-fav', on);
  $('detail-bought').classList.toggle('active', on);
  $('detail-bought').setAttribute('aria-pressed', String(on));
}

function detailSnapshot() {
  return JSON.stringify({
    title: $('detail-title').value,
    brand: comboValue('detail-brand'),
    price: $('detail-price').value,
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
  $('shot-info').textContent = '';
  if (shots.length) showShotInfo(shots[state.detailShot]);
}

// "1440×900 · 312 KB" under the screenshot, so the Optimise decision is visible per entry.
const shotSizes = new Map(); // file -> bytes
async function showShotInfo(file) {
  const img = $('detail-screenshot');
  if (!shotSizes.has(file)) {
    shotSizes.set(file, await fetch(`/uploads/${file}`, { method: 'HEAD' }).then(r => Number(r.headers.get('content-length')) || 0, () => 0));
  }
  if (!img.complete) await new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); });
  if (!state.detailEntry || state.detailEntry.screenshots[state.detailShot] !== file) return; // moved on meanwhile
  $('shot-info').textContent = [img.naturalWidth && `${img.naturalWidth}×${img.naturalHeight}`, shotSizes.get(file) && formatSize(shotSizes.get(file))].filter(Boolean).join(' · ');
}

// Moves to the next/previous screenshot (wrapping); keeps an open lightbox in step.
export function stepShot(delta) {
  const shots = state.detailEntry ? state.detailEntry.screenshots : [];
  if (shots.length < 2) return;
  state.detailShot = (state.detailShot + delta + shots.length) % shots.length;
  renderDetailShots();
  if (isOpen('lightbox-overlay')) setLightboxSrc(`/uploads/${shots[state.detailShot]}`);
}

const noteDraftKey = id => `omniview-note-draft-${state.space}-${id}`;
const clearNoteDraft = () => { if (state.detailEntry) store(noteDraftKey(state.detailEntry.id), null); };

const exactDate = iso => new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

// "3 days ago" (exact date on hover), plus "edited 2 hours ago" once the entry has been changed.
function renderDetailDates(entry) {
  const wrap = $('detail-date');
  wrap.textContent = '';
  const part = (text, iso) => {
    const el = document.createElement('span');
    el.textContent = text;
    el.title = exactDate(iso);
    return el;
  };
  wrap.appendChild(part(timeAgo(entry.date_added), entry.date_added));
  if (entry.updated_at) wrap.append(' · ', part(`edited ${timeAgo(entry.updated_at)}`, entry.updated_at));
  if (entry.visited_at) wrap.append(' · ', part(`site opened ${timeAgo(entry.visited_at)}`, entry.visited_at));
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
  $('detail-close').addEventListener('click', requestCloseDetail);
  $('detail-overlay').addEventListener('click', e => {
    if (e.target === $('detail-overlay')) requestCloseDetail();
  });
  $('detail-prev').addEventListener('click', () => stepDetail(-1));
  $('detail-next').addEventListener('click', () => stepDetail(1));

  $('detail-bought').addEventListener('click', async () => {
    if (!state.detailEntry) return;
    await toggleFlag(state.detailEntry.id, 'bought');
    state.detailEntry = state.entries.find(e => e.id === state.detailEntry.id);
    syncFlagButtons(state.detailEntry);
  });

  $('detail-copy').addEventListener('click', () => {
    if (state.detailEntry) navigator.clipboard.writeText(state.detailEntry.url).then(() => toastSuccess('Copied URL.'), () => toastError('Could not copy.'));
  });

  // An unsaved note survives a crash or closed tab, like the Add form's draft.
  let noteTimer;
  $('detail-note').addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const entry = state.detailEntry;
      if (!entry) return;
      const text = $('detail-note').value;
      store(noteDraftKey(entry.id), text.trim() === entry.note ? null : text);
    }, 400);
  });

  $('detail-price').addEventListener('input', showPriceWas);

  // Marks the site as re-checked; the link itself opens normally.
  $('detail-url').addEventListener('click', () => { if (state.detailEntry) markVisited([state.detailEntry.id]); });

  // Manual only: re-reads the product page and puts the new price in the field, keeping the old one as "was".
  // Nothing is saved until Save Changes.
  $('detail-refresh-price').addEventListener('click', async e => {
    const entry = state.detailEntry;
    if (!entry) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const info = await api.get(`/api/unfurl?url=${encodeURIComponent(entry.url)}`);
      const price = String(guessFashionFields(info, entry.url, { entries: [], types: [], colors: [] }).price || '');
      const current = $('detail-price').value.trim();
      if (!price) toastError('No price found on that page.');
      else if (priceOf({ price }) === priceOf({ price: current })) toastSuccess(`Price unchanged (${current}).`);
      else {
        if (current) detailPriceWas = current;
        $('detail-price').value = price;
        showPriceWas();
        toastSuccess(`Price is now ${price}${current ? ` (was ${current})` : ''}. Save to keep it.`);
      }
    } catch (err) { toastError(err.message); }
    btn.disabled = false;
  });

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
      ...(state.space === 'fashion' && { brand: comboValue('detail-brand'), price: $('detail-price').value.trim(), price_was: detailPriceWas }),
      style_tags: state.detailTags,
      boards: [...state.detailBoards]
    };
    try {
      replaceEntry(await api.put(`/api/entries/${state.detailEntry.id}`, payload));
    } catch (err) {
      toastError(err.message);
      return;
    }
    clearNoteDraft();
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
  document.title = `${titleOf(entry)} · Omniview`;
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
  setCombo('detail-brand', entry.brand || '');
  $('detail-price').value = entry.price || '';
  detailPriceWas = entry.price_was || '';
  showPriceWas();
  syncFlagButtons(entry);
  setCombo('detail-type', entry.type || '');
  setCombo('detail-color', entry.color || '');
  setCombo('detail-found-via', entry.found_via);
  $('detail-note').value = entry.note;
  const draft = load(noteDraftKey(entry.id), null);
  renderDetailDates(entry);

  state.detailShot = 0;
  renderDetailShots();
  renderPalette(entry);
  renderDetailTagPills();
  renderBoardChips($('detail-boards'), state.detailBoards, 'No boards yet.');
  renderSimilar(entry);
  document.querySelector('.detail-meta').scrollTop = 0;

  const canStep = state.navIds.length > 1 && state.navIds.includes(entry.id);
  $('detail-prev').style.display = $('detail-next').style.display = canStep ? '' : 'none';
  detailBaseline = detailSnapshot();
  if (draft !== null && draft.trim() !== entry.note) {
    $('detail-note').value = draft; // after the baseline, so closing still asks about it
    toastSuccess('Restored your unsaved note.');
  }
}

// Previous/next entry in the list the modal was opened from (wrapping).
export function stepDetail(delta) {
  const entry = state.detailEntry;
  const ids = state.navIds;
  const i = entry ? ids.indexOf(entry.id) : -1;
  if (i === -1 || ids.length < 2) return;
  goToEntry(state.entries.find(e => e.id === ids[(i + delta + ids.length) % ids.length]));
}

// Shows another entry in the open modal, asking first if the current one has unsaved edits.
function goToEntry(next) {
  if (!next) return;
  if (detailSnapshot() === detailBaseline) loadDetail(next);
  else confirm_('Discard unsaved changes to this entry?', () => { clearNoteDraft(); loadDetail(next); }, 'Discard');
}

// Closest entries by palette (UI only) and shared tags/type/color, from what's already in memory.
function renderSimilar(entry) {
  const similar = moreLike(entry, state.entries, state.space !== 'fashion');
  $('detail-similar-field').style.display = similar.length ? '' : 'none';
  const row = $('detail-similar');
  row.innerHTML = '';
  similar.forEach(e => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'similar-item';
    btn.title = titleOf(e);
    btn.setAttribute('aria-label', `Open ${titleOf(e)}`);
    if (coverOf(e)) btn.appendChild(thumbImg(coverOf(e))); else btn.innerHTML = PLACEHOLDER_SVG;
    btn.addEventListener('click', () => goToEntry(e));
    row.appendChild(btn);
  });
}

// Close button, backdrop click and Esc: asks first when the form holds unsaved edits.
export function requestCloseDetail() {
  if (state.detailEntry && detailSnapshot() !== detailBaseline) confirm_('Discard unsaved changes to this entry?', () => { clearNoteDraft(); closeDetail(); }, 'Discard');
  else closeDetail();
}

// Hands focus back to the card of the entry you were last on, so keyboard users land where they were.
export function closeDetail() {
  const id = state.detailEntry && state.detailEntry.id;
  closeModalOverlay('detail-overlay');
  document.body.style.overflow = '';
  state.detailEntry = null;
  setTitle();
  if (id) focusCard(id);
}

export function renderDetailTagPills() {
  renderTagPills($('detail-tag-pills'), state.detailTags, tag => {
    const i = state.detailTags.indexOf(tag);
    if (i !== -1) state.detailTags.splice(i, 1);
    renderDetailTagPills();
  });
  renderTagSuggestions($('detail-tag-suggest'), state.detailEntry ? state.detailEntry.palette : [], state.detailTags, renderDetailTagPills);
}
