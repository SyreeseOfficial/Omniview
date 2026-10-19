// Triage: the untagged entries one at a time, a large screenshot, tags on the number keys.

import { state, titleOf, coverOf } from './state.js';
import { api } from './api.js';
import { openModalOverlay, closeModalOverlay, isOpen, toastError, toastSuccess } from './modals.js';
import { renderBrowse } from './browse.js';

const $ = id => document.getElementById(id);

let queue = []; // ids of the entries to go through
let pos = 0;
let tags = [];  // the nine most used tags, bound to keys 1-9

const current = () => state.entries.find(e => e.id === queue[pos]);

export function openTriage() {
  queue = state.entries.filter(e => !e.style_tags.length).sort((a, b) => Date.parse(b.date_added) - Date.parse(a.date_added)).map(e => e.id);
  if (!queue.length) return toastSuccess('Every entry has a tag.');
  const uses = new Map();
  state.entries.forEach(e => e.style_tags.forEach(t => uses.set(t, (uses.get(t) || 0) + 1)));
  tags = [...state.tags].sort((a, b) => (uses.get(b) || 0) - (uses.get(a) || 0) || a.localeCompare(b)).slice(0, 9);
  pos = 0;
  openModalOverlay('triage-overlay');
  $('triage-overlay').querySelector('.modal').focus(); // not the close button, so Space means "next"
  show();
}

function show() {
  const e = current();
  if (!e) return finish();
  $('triage-count').textContent = `${pos + 1} of ${queue.length} untagged`;
  const img = $('triage-img');
  const cover = coverOf(e);
  img.style.display = cover ? '' : 'none';
  if (cover) { img.src = `/uploads/${cover}`; img.alt = titleOf(e); }
  $('triage-title').textContent = titleOf(e);
  $('triage-tags').replaceChildren(...tags.map((t, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (e.style_tags.includes(t) ? ' active' : '');
    chip.setAttribute('aria-pressed', String(e.style_tags.includes(t)));
    chip.tabIndex = -1;
    chip.append(Object.assign(document.createElement('kbd'), { className: 'kbd', textContent: i + 1 }), t);
    chip.addEventListener('click', () => toggle(i));
    return chip;
  }));
}

async function toggle(i) {
  const e = current();
  const tag = tags[i];
  if (!e || !tag) return;
  const next = e.style_tags.includes(tag) ? e.style_tags.filter(t => t !== tag) : [...e.style_tags, tag];
  try {
    const updated = await api.put(`/api/entries/${e.id}`, { style_tags: next });
    state.entries[state.entries.findIndex(x => x.id === e.id)] = updated;
    show();
  } catch (err) { toastError(err.message); }
}

function step(delta) {
  pos = Math.max(0, pos + delta);
  show();
}

function finish() {
  if (isOpen('triage-overlay')) closeModalOverlay('triage-overlay');
  renderBrowse();
}

export function setupTriage() {
  $('triage-close').addEventListener('click', finish);
  // Capture phase, so a number or Space is not also typed into whatever has focus.
  document.addEventListener('keydown', e => {
    if (!isOpen('triage-overlay') || isOpen('confirm-overlay') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); toggle(Number(e.key) - 1); }
    else if (e.key === ' ') { e.preventDefault(); step(1); }
    else if (e.key === 'Backspace') { e.preventDefault(); step(-1); }
  }, true);
}
