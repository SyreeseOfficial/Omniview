// Entry point: boots the app and owns navigation, theme, the sidebar, global
// keyboard shortcuts, and paste / drag-and-drop of images.

import { state } from './state.js';
import { api } from './api.js';
import {
  isOpen, confirm_, toastError, setupConfirmModal, setupPromptModal, setupLightbox, closeLightbox
} from './modals.js';
import { setupCombos } from './options.js';
import {
  loadPersistedFilters, setupSearch, setupFilters, setupLayoutSwitch, setupBulk, renderBrowse, renderFavorites
} from './browse.js';
import { setupBoards, renderBoards, closeBoardPicker } from './boards.js';
import {
  setupAddForm, setupDetailModal, openAddForm, isFormDirty, clearFormSnapshot, closeDetail,
  addPendingFiles, applyDetailScreenshots, stepDetail, stepShot
} from './entry.js';
import { setupSettings, renderSettings } from './settings.js';

const $ = id => document.getElementById(id);

async function init() {
  loadPersistedFilters();
  await loadAll();
  setupCombos();
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
const anyDialogOpen = () => ['confirm-overlay', 'prompt-overlay', 'board-picker-overlay', 'lightbox-overlay'].some(isOpen);

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
    receiveImages([...items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean));
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
      navigate(el.dataset.view);
    });
  });
}

export function navigate(view) {
  if (isFormDirty()) {
    confirm_('Discard unsaved changes to this entry?', () => { clearFormSnapshot(); doNavigate(view); }, 'Discard');
    return;
  }
  doNavigate(view);
}

function doNavigate(view) {
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
}

// ═══════════════════════════════════════════ THEME ══
function setupTheme() {
  const root = document.documentElement;
  setTheme(localStorage.getItem('omniview-theme') || 'dark');

  $('theme-toggle').addEventListener('click', () => {
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
      if (isOpen('detail-overlay')) return closeDetail();
      if (isOpen('board-picker-overlay')) return closeBoardPicker();
      return;
    }

    // Ctrl/Cmd+Enter saves whatever form or modal you're typing in.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const form = e.target.closest('form');
      if (form) { e.preventDefault(); form.requestSubmit(); return; }
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
      case '?': navigate('shortcuts'); break;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
