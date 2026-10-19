// Boards view: the board grid, a single board's entries, the "add entries"
// picker, and drag-to-another-board.

import { state, PLACEHOLDER_SVG, escHtml, titleOf, thumbImg, priceTotal, boardLabel } from './state.js';
import { api } from './api.js';
import { orderEntries } from './lib.js';
import { confirm_, prompt_, toastSuccess, toastError, openModalOverlay, closeModalOverlay } from './modals.js';
import { renderGrid, renderBoardFilters, updateStats } from './browse.js';
import { updateFormBoardChips } from './entry.js';
import { navigate } from './main.js';

const $ = id => document.getElementById(id);

export function renderBoards() {
  // Reset board detail
  $('boards-grid').style.display = '';
  $('board-detail').style.display = 'none';
  $('boards-title').textContent = 'Boards';
  $('new-board-btn').style.display = '';

  const grid = $('boards-grid');
  grid.innerHTML = '';
  const empty = $('boards-empty');

  updateStats();
  if (state.boards.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  state.boards.forEach(board => {
    const entries = boardEntries(board);
    const card = document.createElement('div');
    card.className = 'board-card' + (board.color ? ' has-color' : '');
    card.style.setProperty('--board-color', board.color || 'transparent');
    card.appendChild(boardThumbCollage(entries));
    const meta = document.createElement('div');
    meta.className = 'board-card-meta';
    meta.innerHTML = `<div class="board-name">${escHtml(boardLabel(board))}</div><div class="board-count">${[`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`, priceTotal(entries)].filter(Boolean).join(' · ')}</div>`;
    card.appendChild(meta);

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'board-pin' + (board.pinned ? ' on' : '');
    pin.textContent = board.pinned ? '★' : '☆';
    pin.title = pin.ariaLabel = board.pinned ? 'Unpin from sidebar' : 'Pin to sidebar';
    pin.addEventListener('click', e => { e.stopPropagation(); setBoardPinned(board, !board.pinned); });
    card.appendChild(pin);

    card.addEventListener('click', () => openBoard(board));
    card.draggable = true;
    card.addEventListener('dragstart', e => { draggedBoardId = board.id; e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { draggedBoardId = null; card.classList.remove('dragging'); });
    card.addEventListener('dragover', e => { if (draggedBoardId && draggedBoardId !== board.id) { e.preventDefault(); card.classList.add('drag-over'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      card.classList.remove('drag-over');
      if (!draggedBoardId || draggedBoardId === board.id) return;
      e.preventDefault();
      moveBoard(draggedBoardId, board.id);
    });
    grid.appendChild(card);
  });
}

let draggedBoardId = null;

// A board's entries in its manual order (newest first for anything not yet placed).
const boardEntries = board => orderEntries(state.entries.filter(e => e.boards.includes(board.id)), board.order || []);

// Replaces a board in state with the server's copy and refreshes whatever shows it.
function boardSaved(updated) {
  const i = state.boards.findIndex(b => b.id === updated.id);
  if (i !== -1) state.boards[i] = updated;
  if (state.currentBoard && state.currentBoard.id === updated.id) state.currentBoard = updated;
  return updated;
}

async function setBoardPinned(board, pinned) {
  try { boardSaved(await api.put(`/api/boards/${board.id}`, { pinned })); } catch (err) { return toastError(err.message); }
  if (state.currentBoard) openBoard(state.currentBoard); else renderBoards();
  renderSidebarBoards();
}

// Dragging a board card onto another takes that card's place in the list.
async function moveBoard(dragId, targetId) {
  const ids = state.boards.map(b => b.id);
  const to = ids.indexOf(targetId);
  ids.splice(ids.indexOf(dragId), 1);
  ids.splice(to, 0, dragId);
  state.boards = ids.map(id => state.boards.find(b => b.id === id));
  renderBoards();
  try { await api.put('/api/boards/order', { ids }); } catch (err) { toastError(err.message); }
}

// Dragging an entry card onto another inside an open board takes that card's place.
export async function reorderInBoard(boardId, dragId, targetId) {
  const board = state.boards.find(b => b.id === boardId);
  if (!board) return;
  const ids = boardEntries(board).map(e => e.id);
  const to = ids.indexOf(targetId);
  if (to === -1 || !ids.includes(dragId)) return;
  ids.splice(ids.indexOf(dragId), 1);
  ids.splice(to, 0, dragId);
  board.order = ids;
  openBoard(board);
  try { await api.put(`/api/boards/${boardId}/order`, { ids }); } catch (err) { toastError(err.message); }
}

// Pinned boards, one click away under "Boards" in the sidebar.
export function renderSidebarBoards() {
  const wrap = $('sidebar-boards');
  wrap.innerHTML = '';
  state.boards.filter(b => b.pinned).forEach(board => {
    const a = document.createElement('a');
    a.className = 'nav-item nav-sub';
    a.href = '#';
    a.title = board.name;
    const mark = document.createElement('span');
    mark.className = 'pin-mark' + (board.color ? '' : ' plain');
    mark.style.setProperty('--board-color', board.color || '');
    mark.textContent = board.emoji || [...board.name][0].toUpperCase();
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = board.name;
    a.append(mark, label);
    a.addEventListener('click', e => {
      e.preventDefault();
      navigate('boards', () => openBoard(state.boards.find(b => b.id === board.id)));
    });
    wrap.appendChild(a);
  });
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
      cell.appendChild(thumbImg(entry.screenshot));
    } else {
      cell.classList.add('empty');
      cell.innerHTML = PLACEHOLDER_SVG;
    }
    wrap.appendChild(cell);
  }
  return wrap;
}

// After a board was edited, deleted, or created.
function boardsChanged() {
  updateFormBoardChips();
  renderBoardFilters();
  updateStats();
}

export function openBoard(board) {
  state.currentBoard = board;
  $('boards-grid').style.display = 'none';
  $('boards-empty').style.display = 'none';
  $('new-board-btn').style.display = 'none';
  $('boards-title').textContent = boardLabel(board);
  $('board-detail').style.display = '';
  $('board-desc').textContent = board.description || '';
  $('board-desc').style.display = board.description ? '' : 'none';
  const pin = $('pin-board-btn');
  pin.textContent = board.pinned ? '★ Pinned' : '☆ Pin';
  pin.setAttribute('aria-pressed', String(!!board.pinned));
  pin.onclick = () => setBoardPinned(board, !board.pinned);

  $('add-to-board-btn').onclick = () => openBoardPicker(board);
  $('edit-board-btn').onclick = () => openBoardEdit(board);

  $('delete-board-btn').onclick = () => {
    confirm_(`Delete board "${board.name}"? Entries will not be deleted.`, async () => {
      await api.del(`/api/boards/${board.id}`);
      state.boards = state.boards.filter(b => b.id !== board.id);
      state.entries.forEach(e => { e.boards = e.boards.filter(id => id !== board.id); });
      state.currentBoard = null;
      renderBoards();
      boardsChanged();
    });
  };

  const entries = boardEntries(board);
  state.navIds = entries.map(e => e.id);
  renderGrid($('board-entry-grid'), entries, true, board.id);
  $('board-total').textContent = priceTotal(entries);
  $('board-empty').style.display = entries.length === 0 ? '' : 'none';
  renderDropTargets(board);
}

// Other boards, as drop targets for dragging a card out of this board: a plain
// drop adds the entry to that board, Shift moves it.
function renderDropTargets(board) {
  const wrap = $('board-drop-targets');
  const others = state.boards.filter(b => b.id !== board.id);
  wrap.style.display = others.length ? '' : 'none';
  wrap.innerHTML = '<span class="drop-hint">Drag a card onto a board to add it (hold Shift to move):</span>';
  others.forEach(target => {
    const chip = document.createElement('div');
    chip.className = 'board-chip-toggle drop-target';
    chip.textContent = boardLabel(target);
    chip.addEventListener('dragover', e => { e.preventDefault(); chip.classList.add('drag-over'); });
    chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
    chip.addEventListener('drop', e => {
      e.preventDefault();
      chip.classList.remove('drag-over');
      dropOnBoard(e.dataTransfer.getData('text/plain'), board, target, e.shiftKey);
    });
    wrap.appendChild(chip);
  });
}

async function dropOnBoard(entryId, from, target, move) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  if (!entry.boards.includes(target.id)) {
    await api.post('/api/entries/bulk', { ids: [entryId], action: 'addToBoard', boards: target.id });
    entry.boards.push(target.id);
  }
  if (move) {
    await api.post('/api/entries/bulk', { ids: [entryId], action: 'removeFromBoard', boards: from.id });
    entry.boards = entry.boards.filter(b => b !== from.id);
  }
  openBoard(from);
  toastSuccess(`${move ? 'Moved' : 'Added'} to ${target.name}.`);
}

export async function removeEntryFromBoard(entryId, boardId) {
  const idx = state.entries.findIndex(e => e.id === entryId);
  if (idx === -1) return;
  const boards = state.entries[idx].boards.filter(b => b !== boardId);
  state.entries[idx] = await api.put(`/api/entries/${entryId}`, { boards });
  if (state.currentBoard && state.currentBoard.id === boardId) openBoard(state.currentBoard);
  renderBoardFilters();
  toastSuccess('Removed from board.');
}

// ── Board editor: name, emoji, accent color, description ──
const BOARD_COLORS = ['', '#e5484d', '#f76b15', '#f5d90a', '#30a46c', '#3e63dd', '#8e4ec6', '#e93d82'];
let editColor = '';

export function closeBoardEdit() {
  closeModalOverlay('board-edit-overlay');
}

function paintColorDots() {
  document.querySelectorAll('#board-edit-colors .color-dot').forEach(d => d.setAttribute('aria-pressed', String(d.dataset.color === editColor)));
}

function openBoardEdit(board) {
  $('board-edit-name').value = board.name;
  $('board-edit-emoji').value = board.emoji || '';
  $('board-edit-desc').value = board.description || '';
  editColor = board.color || '';
  paintColorDots();
  $('board-edit-form').dataset.id = board.id;
  openModalOverlay('board-edit-overlay');
  $('board-edit-name').select();
}

// ── Board picker: add existing entries to the currently open board ──
export function closeBoardPicker() {
  closeModalOverlay('board-picker-overlay');
}

function openBoardPicker(board) {
  const list = $('board-picker-list');
  list.innerHTML = '';
  const available = state.entries.filter(e => !e.boards.includes(board.id));

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
        thumb.appendChild(thumbImg(entry.screenshot));
      } else {
        thumb.classList.add('empty');
        thumb.innerHTML = PLACEHOLDER_SVG;
      }

      // Title when there is one, otherwise the source URL.
      const name = document.createElement('div');
      name.className = 'picker-title';
      name.textContent = titleOf(entry);
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

export function setupBoards() {
  BOARD_COLORS.forEach(color => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-dot' + (color ? '' : ' none');
    dot.dataset.color = color;
    dot.style.setProperty('--c', color);
    dot.title = dot.ariaLabel = color ? `Accent ${color}` : 'No accent color';
    dot.addEventListener('click', () => { editColor = color; paintColorDots(); });
    $('board-edit-colors').appendChild(dot);
  });
  $('board-edit-cancel').addEventListener('click', closeBoardEdit);
  $('board-edit-overlay').addEventListener('click', e => { if (e.target === $('board-edit-overlay')) closeBoardEdit(); });
  $('board-edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = e.target.dataset.id;
    try {
      const updated = boardSaved(await api.put(`/api/boards/${id}`, {
        name: $('board-edit-name').value,
        emoji: $('board-edit-emoji').value,
        color: editColor,
        description: $('board-edit-desc').value
      }));
      closeBoardEdit();
      openBoard(updated);
      boardsChanged();
    } catch (err) { toastError(err.message); }
  });

  $('board-picker-cancel').addEventListener('click', closeBoardPicker);
  $('board-picker-overlay').addEventListener('click', e => {
    if (e.target === $('board-picker-overlay')) closeBoardPicker();
  });

  $('board-picker-add').addEventListener('click', async () => {
    const board = state.currentBoard;
    if (!board) return;
    const ids = [...document.querySelectorAll('#board-picker-list input:checked')].map(el => el.value);
    if (ids.length === 0) { closeBoardPicker(); return; }
    await api.post('/api/entries/bulk', { ids, action: 'addToBoard', boards: board.id });
    ids.forEach(id => {
      const entry = state.entries.find(e => e.id === id);
      if (entry && !entry.boards.includes(board.id)) entry.boards.push(board.id);
    });
    closeBoardPicker();
    openBoard(board);
    renderBoardFilters();
  });

  $('board-back').addEventListener('click', () => {
    state.currentBoard = null;
    renderBoards();
  });

  $('new-board-btn').addEventListener('click', () => {
    prompt_('New board', '', async name => {
      if (!name) return;
      const board = await api.post('/api/boards', { name });
      state.boards.push(board);
      renderBoards();
      boardsChanged();
    });
  });
}
