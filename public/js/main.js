// Entry point: boots the app and owns navigation, theme, the sidebar, global
// keyboard shortcuts, and paste / drag-and-drop of images.

import { state, SPACES, FEATURES, config, isHttpUrl } from './state.js';
import { api, recheck } from './api.js';
import {
  isOpen, confirm_, toastError, setupConfirmModal, setupPromptModal, setupLightbox, closeLightbox
} from './modals.js';
import { setupCombos } from './options.js';
import {
  loadPersistedFilters, setupSearch, setupFilters, setupLayoutSwitch, setupBulk, setBulkMode, renderBrowse, updateStats
} from './browse.js';
import { renderStats } from './stats.js';
import { setupBoards, renderBoards, closeBoardPicker, closeBoardEdit } from './boards.js';
import {
  setupAddForm, setupDetailModal, openAddForm, isFormDirty, clearFormSnapshot, requestCloseDetail,
  addPendingFiles, applyDetailScreenshots, pasteUrlIntoForm, stepDetail, stepShot
} from './entry.js';
import { setupSettings, renderSettings } from './settings.js';
import { setupTriage } from './triage.js';

const $ = id => document.getElementById(id);

async function init() {
  markOpened();
  await loadSpaces();
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
  setupTriage();
  setupImageInput();
  renderBrowse();

  $('save-banner-retry').addEventListener('click', recheck);
  $('notice-banner-close').addEventListener('click', () => {
    try { localStorage.setItem(`omniview-notice-${state.space}`, NOTICES[state.space] || ''); } catch { /* storage unavailable */ }
    $('notice-banner').hidden = true;
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });

  window.addEventListener('beforeunload', e => {
    if (isFormDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
  // Anything an event handler forgot to catch (a failed request, usually) still reaches the user.
  window.addEventListener('unhandledrejection', e => {
    e.preventDefault();
    toastError((e.reason && e.reason.message) || 'Something went wrong.');
  });
}

// The server owns the list of libraries; build the switcher from it.
const SPACE_ICONS = {
  ui: '<rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 6h13" stroke="currentColor" stroke-width="1.5"/>',
  fashion: '<path d="M5.5 2L1.5 4.5l1.5 3 1.5-.8V14h7V6.7l1.5.8 1.5-3L10.5 2c-.3 1-1.2 1.7-2.5 1.7S5.8 3 5.5 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'
};
// A library the server had to restore from a backup says so once per notice.
const NOTICES = {};
function showNotice() {
  const text = NOTICES[state.space];
  let seen = null;
  try { seen = localStorage.getItem(`omniview-notice-${state.space}`); } catch { /* storage unavailable */ }
  $('notice-banner').hidden = !text || seen === text;
  $('notice-banner-text').textContent = text || '';
}

// "New" dots mark what was added since the app was last opened; the stamp moves on at every start.
function markOpened() {
  try {
    state.sinceOpen = Number(localStorage.getItem('omniview-last-open')) || 0;
    localStorage.setItem('omniview-last-open', String(Date.now()));
  } catch { /* storage unavailable: no dots */ }
}

const DEFAULT_SPACE_ICON = '<path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 2h4.5A1.5 1.5 0 0114 6.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';

async function loadSpaces() {
  const list = await api.get('/api/spaces', 'ui');
  Object.keys(SPACES).forEach(k => delete SPACES[k]);
  list.forEach(s => { SPACES[s.name] = s.label; FEATURES[s.name] = s.features || {}; NOTICES[s.name] = s.notice; });
  Object.assign(config, await api.get('/api/config', 'ui'));
  if (!SPACES[state.space]) state.space = 'ui';
  $('space-switch').replaceChildren(...list.map(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'space-btn';
    b.dataset.space = s.name;
    b.title = `${s.label} (G)`;
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"></svg><span class="nav-label"></span>';
    b.querySelector('svg').innerHTML = SPACE_ICONS[s.name] || DEFAULT_SPACE_ICON; // trusted constants
    b.querySelector('.nav-label').textContent = s.label;
    return b;
  }));
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

// Remembers where each library was scrolled to, so G brings you back to the same spot.
const scrollAt = {};

// ═══════════════════════════════════════════ PASTE / DROP IMAGE ══
const isImage = f => f.type && f.type.startsWith('image/');
const anyDialogOpen = () => ['confirm-overlay', 'prompt-overlay', 'board-picker-overlay', 'board-edit-overlay', 'lightbox-overlay', 'triage-overlay'].some(isOpen);

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

  // Dropping an image anywhere on the window works, not just on the drop zone. So does a link
  // (from the address bar or a page): it starts a new entry with autofill.
  const dragTypes = e => [...((e.dataTransfer && e.dataTransfer.types) || [])];
  const hasFiles = e => dragTypes(e).includes('Files');
  const hasLink = e => dragTypes(e).includes('text/uri-list');
  let depth = 0;
  const endDrag = () => { depth = 0; document.body.classList.remove('file-drag'); };
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; document.body.classList.add('file-drag'); } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) endDrag(); });
  window.addEventListener('dragover', e => { if (hasFiles(e) || hasLink(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    endDrag();
    if (!hasFiles(e) && hasLink(e) && !e.defaultPrevented && !anyDialogOpen()) {
      const url = e.dataTransfer.getData('text/uri-list').split('\n').find(l => isHttpUrl(l.trim()))?.trim();
      if (url) { e.preventDefault(); if (state.view !== 'add') navigate('add', () => pasteUrlIntoForm(url)); else pasteUrlIntoForm(url); }
      return;
    }
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
      navigate(el.dataset.view);
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

const VIEW_TITLES = { browse: '', boards: 'Boards', add: 'Add Entry', stats: 'Stats', settings: 'Settings' };

// The tab title names the library and the screen ("Omniview · Fashion · Boards").
export function setTitle() {
  document.title = ['Omniview', state.space === 'ui' ? '' : SPACES[state.space], VIEW_TITLES[state.view]].filter(Boolean).join(' · ');
}

function doNavigate(view, then) {
  state.view = view;
  setTitle();
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
  if (view === 'stats') renderStats();
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
  setTitle();
  document.documentElement.toggleAttribute('data-no-via', FEATURES[state.space]?.foundVia === false);
  showNotice();
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
  // Plain links can't send the X-Space header, so the export link carries it in the URL.
  $('export-zip').href = `/api/export?format=zip&space=${state.space}`;
  syncFavicon();
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
  scrollAt[prev] = window.scrollY;
  state.space = next; // the requests below go to the new library
  const main = document.querySelector('.main');
  main.classList.add('switching'); // dims the grid so a slow response doesn't look like a hang
  main.setAttribute('aria-busy', 'true');
  try {
    await loadAll();
  } catch (err) {
    state.space = prev;
    toastError(err.message);
    return;
  } finally {
    main.classList.remove('switching');
    main.removeAttribute('aria-busy');
  }
  try { localStorage.setItem('omniview-space', next); } catch { /* storage unavailable */ }
  loadPersistedFilters();
  if (state.bulkMode) setBulkMode(false);
  state.selectedIds.clear();
  state.currentBoard = null;
  applySpaceUI();
  updateStats();
  doNavigate(state.view);
  requestAnimationFrame(() => window.scrollTo(0, scrollAt[next] ?? 0));
}

// ═══════════════════════════════════════════ THEME ══
// <html data-theme> holds 'dark' or 'light'; the head script in index.html applies it before first paint.
function setupTheme() {
  setTheme(localStorage.getItem('omniview-theme') === 'light' ? 'light' : 'dark');
  $('theme-toggle').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.t));
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('omniview-theme', theme); } catch { /* storage unavailable */ }
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.t === theme));
  syncFavicon();
}

// The tab icon follows whatever accent the theme and library are showing.
function syncFavicon() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b7cf8';
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
const SHORTCUTS = [
  'N: new entry', '/: focus search', 'G: switch library', '?: this list',
  'Left / Right: previous or next entry (or screenshot in the lightbox)',
  'Ctrl+Enter: save the form; Ctrl+Shift+Enter: save and add another',
  'Esc: close a dialog'
];

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // Dialogs can stack on top of each other (e.g. delete-entry over the
      // detail modal), so the topmost must be checked first — otherwise Escape
      // closes the modal underneath instead of the one on top.
      if (isOpen('lightbox-overlay')) return closeLightbox();
      if (isOpen('confirm-overlay')) return $('confirm-cancel').click();
      if (isOpen('prompt-overlay')) return $('prompt-cancel').click();
      if (isOpen('triage-overlay')) return $('triage-close').click();
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
    if (isOpen('triage-overlay')) return;

    switch (e.key) {
      case '/': e.preventDefault(); navigate('browse'); $('search-input').focus(); break;
      case 'n': case 'N': navigate('add'); break;
      case 'g': case 'G': { const names = Object.keys(SPACES); switchSpace(names[(names.indexOf(state.space) + 1) % names.length]); break; }
      case '?': confirm_('Keyboard shortcuts', null, '', SHORTCUTS); break;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
