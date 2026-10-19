// Entry point: boots the app and owns navigation, theme, the sidebar, global
// keyboard shortcuts, and paste / drag-and-drop of images.

import { state, SPACES, isHttpUrl, spaceKey } from './state.js';
import { api } from './api.js';
import {
  isOpen, confirm_, toastError, setupConfirmModal, setupPromptModal, setupLightbox, closeLightbox, withTransition
} from './modals.js';
import { setupCombos } from './options.js';
import {
  loadPersistedFilters, setupSearch, setupFilters, setupLayoutSwitch, setupBulk, setBulkMode, renderBrowse, renderFavorites, updateStats
} from './browse.js';
import { setupBoards, renderBoards, closeBoardPicker, closeBoardEdit } from './boards.js';
import {
  setupAddForm, setupDetailModal, openAddForm, isFormDirty, clearFormSnapshot, requestCloseDetail,
  addPendingFiles, applyDetailScreenshots, pasteUrlIntoForm, stepDetail, stepShot
} from './entry.js';
import { setupSettings, renderSettings } from './settings.js';

const $ = id => document.getElementById(id);

async function init() {
  loadPersistedFilters();
  applySpaceUI();
  await loadAll();
  setupCombos();
  setupNav();
  setupSpaceSwitch();
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
  setupPromptModal();
  setupLightbox();
  setupBoards();
  setupSettings();
  setupImageInput();
  renderBrowse();

  window.addEventListener('beforeunload', e => {
    if (isFormDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
  // Anything an event handler forgot to catch (a failed request, usually) still reaches the user.
  window.addEventListener('unhandledrejection', e => {
    e.preventDefault();
    toastError((e.reason && e.reason.message) || 'Something went wrong.');
  });
}

export async function loadAll() {
  [state.entries, state.boards, state.tags, state.types, state.foundVia] = await Promise.all([
    api.get('/api/entries'),
    api.get('/api/boards'),
    api.get('/api/tags'),
    api.get('/api/types'),
    api.get('/api/found-via')
  ]);
  $('browse-loading').style.display = 'none';
}

// ═══════════════════════════════════════════ PASTE / DROP IMAGE ══
const isImage = f => f.type && f.type.startsWith('image/');
const anyDialogOpen = () => ['confirm-overlay', 'prompt-overlay', 'board-picker-overlay', 'board-edit-overlay', 'lightbox-overlay'].some(isOpen);

// Hands images to whatever is showing: the open entry (as extra screenshots),
// otherwise a new entry in the Add form.
function receiveImages(files) {
  const images = files.filter(isImage);
  if (!images.length || anyDialogOpen()) return;
  if (isOpen('detail-overlay')) { applyDetailScreenshots(images); return; }
  if (state.view !== 'add') navigate('add');
  addPendingFiles(images);
}

function setupImageInput() {
  document.addEventListener('paste', e => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [...items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    receiveImages(files);
    // A URL pasted outside any field starts a new entry (pasting into a field stays a normal paste).
    if (files.length || anyDialogOpen() || isOpen('detail-overlay') || e.target.closest('input, textarea, select, [contenteditable]')) return;
    const text = ((e.clipboardData && e.clipboardData.getData('text')) || '').trim();
    if (!isHttpUrl(text)) return;
    if (state.view !== 'add') navigate('add');
    pasteUrlIntoForm(text);
  });

  // Dropping an image anywhere on the window works, not just on the drop zone.
  const hasFiles = e => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  let depth = 0;
  const endDrag = () => { depth = 0; document.body.classList.remove('file-drag'); };
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; document.body.classList.add('file-drag'); } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) endDrag(); });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    endDrag();
    if (!hasFiles(e)) return;
    const alreadyHandled = e.defaultPrevented; // the Add form's drop zone handles its own drops
    e.preventDefault(); // otherwise the browser would navigate to the dropped file
    if (!alreadyHandled) receiveImages([...e.dataTransfer.files]);
  });
}

// ═══════════════════════════════════════════ NAVIGATION ══
function setupNav() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      withTransition(() => navigate(el.dataset.view));
    });
  });
}

// `then` runs once the view has switched (after the discard prompt, if there was one).
export function navigate(view, then) {
  if (isFormDirty()) {
    confirm_('Discard unsaved changes to this entry?', () => { clearFormSnapshot(); doNavigate(view, then); }, 'Discard');
    return;
  }
  doNavigate(view, then);
}

function doNavigate(view, then) {
  state.view = view;
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  // Show target view
  const el = $(`view-${view}`);
  if (el) el.style.display = 'block';
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  // Render
  if (view === 'browse') renderBrowse();
  if (view === 'boards') renderBoards();
  if (view === 'favorites') renderFavorites();
  if (view === 'add') openAddForm();
  if (view === 'settings') renderSettings();
  if (then) then();
}

// ═══════════════════════════════════════════ SPACES (UI / Fashion) ══
// Everything space-specific in the markup is driven by <html data-space> (CSS
// .ui-only / .fashion-only) plus these attributes: data-fashion-text and
// data-fashion-placeholder hold the fashion wording, the markup keeps the UI one.
function applySpaceUI() {
  const fashion = state.space === 'fashion';
  document.documentElement.dataset.space = state.space;
  document.title = fashion ? 'Omniview · Fashion' : 'Omniview';
  document.querySelectorAll('.space-btn').forEach(b => {
    const on = b.dataset.space === state.space;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('[data-fashion-text]').forEach(el => {
    el.dataset.uiText ??= el.textContent;
    el.textContent = fashion ? el.dataset.fashionText : el.dataset.uiText;
  });
  document.querySelectorAll('[data-fashion-placeholder]').forEach(el => {
    el.dataset.uiPlaceholder ??= el.placeholder;
    el.placeholder = fashion ? el.dataset.fashionPlaceholder : el.dataset.uiPlaceholder;
  });
  document.querySelectorAll('.space-name').forEach(el => { el.textContent = SPACES[state.space]; });
  // Plain links can't send the X-Space header, so the export links carry it in the URL.
  $('export-json').href = `/api/export?format=json&space=${state.space}`;
  $('export-zip').href = `/api/export?format=zip&space=${state.space}`;
  applyAccent();
}

function setupSpaceSwitch() {
  document.querySelectorAll('.space-btn').forEach(b => b.addEventListener('click', () => switchSpace(b.dataset.space)));
}

export function switchSpace(next) {
  if (next === state.space) return;
  if (isFormDirty()) {
    confirm_('Discard unsaved changes to this entry?', () => { clearFormSnapshot(); doSwitchSpace(next); }, 'Discard');
    return;
  }
  return doSwitchSpace(next);
}

async function doSwitchSpace(next) {
  const prev = state.space;
  state.space = next; // the requests below go to the new library
  try {
    await loadAll();
  } catch (err) {
    state.space = prev;
    toastError(err.message);
    return;
  }
  try { localStorage.setItem('omniview-space', next); } catch { /* storage unavailable */ }
  loadPersistedFilters();
  if (state.bulkMode) setBulkMode(false);
  state.selectedIds.clear();
  state.currentBoard = null;
  applySpaceUI();
  updateStats();
  doNavigate(state.view);
}

// ═══════════════════════════════════════════ THEME ══
// The stored preference is 'dark', 'light' or 'system'; <html data-theme> always holds
// the resolved dark/light that the CSS keys on.
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const storedTheme = () => { try { return localStorage.getItem('omniview-theme'); } catch { return null; } };

function setupTheme() {
  setTheme(storedTheme() || 'dark');
  systemDark.addEventListener('change', () => { if (storedTheme() === 'system') setTheme('system'); });

  $('theme-toggle').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.t));
  });

  $('accent-input').addEventListener('input', e => {
    try { localStorage.setItem(spaceKey('omniview-accent'), e.target.value); } catch { /* storage unavailable */ }
    applyAccent();
  });
  $('accent-reset').addEventListener('click', () => {
    try { localStorage.removeItem(spaceKey('omniview-accent')); } catch { /* storage unavailable */ }
    applyAccent();
  });
}

function setTheme(pref) {
  document.documentElement.dataset.theme = pref === 'system' ? (systemDark.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.themePref = pref;
  try { localStorage.setItem('omniview-theme', pref); } catch { /* storage unavailable */ }
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.t === pref));
  applyAccent();
}

// A user-picked accent (kept per library) overrides the theme's; clearing it falls back to the
// theme/library default. The tab icon follows whatever accent is showing.
export function applyAccent() {
  const root = document.documentElement;
  let custom = null;
  try { custom = localStorage.getItem(spaceKey('omniview-accent')); } catch { /* storage unavailable */ }
  if (custom && /^#[0-9a-f]{6}$/i.test(custom)) {
    root.style.setProperty('--accent', custom);
    root.style.setProperty('--accent-dim', `color-mix(in srgb, ${custom} 15%, transparent)`);
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-dim');
  }
  const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#8b7cf8';
  $('accent-input').value = accent;
  $('favicon').href = 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="${accent}"><rect x="1" y="1" width="9" height="9" rx="2" opacity=".9"/><rect x="12" y="1" width="9" height="5" rx="2" opacity=".6"/><rect x="12" y="8" width="9" height="3" rx="1.5" opacity=".4"/><rect x="1" y="12" width="9" height="9" rx="2" opacity=".5"/><rect x="12" y="13" width="9" height="8" rx="2" opacity=".75"/></svg>`);
}

// ═══════════════════════════════════════════ SIDEBAR COLLAPSE ══
function setupSidebarCollapse() {
  const sidebar = document.querySelector('.sidebar');
  setSidebarCollapsed(localStorage.getItem('omniview-sidebar-collapsed') === '1');
  $('sidebar-toggle').addEventListener('click', () => setSidebarCollapsed(!sidebar.classList.contains('collapsed')));
}

function setSidebarCollapsed(collapsed) {
  const btn = $('sidebar-toggle');
  document.querySelector('.sidebar').classList.toggle('collapsed', collapsed);
  localStorage.setItem('omniview-sidebar-collapsed', collapsed ? '1' : '0');
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-expanded', String(!collapsed));
}

// ═══════════════════════════════════════════ KEYBOARD SHORTCUTS ══
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // Dialogs can stack on top of each other (e.g. delete-entry over the
      // detail modal), so the topmost must be checked first — otherwise Escape
      // closes the modal underneath instead of the one on top.
      if (isOpen('lightbox-overlay')) return closeLightbox();
      if (isOpen('confirm-overlay')) return $('confirm-cancel').click();
      if (isOpen('prompt-overlay')) return $('prompt-cancel').click();
      if (isOpen('detail-overlay')) return requestCloseDetail();
      if (isOpen('board-edit-overlay')) return closeBoardEdit();
      if (isOpen('board-picker-overlay')) return closeBoardPicker();
      return;
    }

    // Ctrl/Cmd+Enter saves whatever form or modal you're typing in.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const form = e.target.closest('form');
      if (form) {
        e.preventDefault();
        if (e.shiftKey && form.id === 'entry-form') $('form-submit-another').click(); else form.requestSubmit();
        return;
      }
      if (e.target.closest('#detail-overlay')) { e.preventDefault(); $('detail-save').click(); }
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;

    // Left/Right: previous/next screenshot in the lightbox, previous/next entry in the detail modal.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      if (isOpen('lightbox-overlay')) { e.preventDefault(); stepShot(delta); }
      else if (isOpen('detail-overlay') && !anyDialogOpen()) { e.preventDefault(); stepDetail(delta); }
      return;
    }

    if (isOpen('detail-overlay') || anyDialogOpen()) return;

    switch (e.key) {
      case '/': e.preventDefault(); navigate('browse'); $('search-input').focus(); break;
      case 'n': case 'N': navigate('add'); break;
      case 'b': case 'B': navigate('browse'); break;
      case 'o': case 'O': navigate('boards'); break;
      case 'f': case 'F': navigate('favorites'); break;
      case 's': case 'S': navigate('settings'); break;
      case 'r': case 'R': $('random-btn').click(); break;
      case 'g': case 'G': switchSpace(state.space === 'ui' ? 'fashion' : 'ui'); break;
      case '?': navigate('shortcuts'); break;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
