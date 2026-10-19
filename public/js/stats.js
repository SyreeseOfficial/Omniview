// Stats view: everything is derived from the entries already in memory.

import { state } from './state.js';
import { libraryStats } from './lib.js';

const $ = id => document.getElementById(id);

function el(tag, className, text) {
  const x = document.createElement(tag);
  if (className) x.className = className;
  if (text !== undefined) x.textContent = text;
  return x;
}

// Ranked horizontal bars; one series, so one color and no legend (the heading names it).
function barList(title, rows) {
  const card = el('div', 'settings-section stats-card');
  card.append(el('h2', 'settings-heading', title));
  if (!rows.length) { card.append(el('p', 'settings-desc', 'Nothing yet.')); return card; }
  const max = rows[0][1];
  for (const [name, n] of rows) {
    const row = el('div', 'stats-row');
    row.title = `${name}: ${n}`;
    const bar = el('span', 'stats-bar');
    bar.style.width = `${Math.max(2, (n / max) * 100)}%`;
    row.append(el('span', 'stats-name', name), el('span', 'stats-track'), el('span', 'stats-n', n));
    row.querySelector('.stats-track').append(bar);
    card.append(row);
  }
  return card;
}

export function renderStats() {
  const s = libraryStats(state.entries);
  const root = $('stats-body');
  root.replaceChildren();

  const months = el('div', 'settings-section stats-card stats-wide');
  months.append(el('h2', 'settings-heading', 'Added per month'));
  const max = Math.max(1, ...s.perMonth.map(m => m.n));
  const chart = el('div', 'stats-months');
  for (const m of s.perMonth) {
    const col = el('div', 'stats-month');
    col.title = `${m.label} ${m.key.slice(0, 4)}: ${m.n}`;
    const bar = el('span', 'stats-col');
    bar.style.height = `${m.n ? Math.max(4, (m.n / max) * 100) : 0}%`;
    col.append(el('span', 'stats-n', m.n || ''), bar, el('span', 'stats-label', m.label));
    chart.append(col);
  }
  months.append(chart);
  root.append(months, barList('Top tags', s.tags), barList('Found via', s.via), barList(state.space === 'fashion' ? 'Item types' : 'Entry types', s.types));

  if (state.space === 'ui') {
    const card = el('div', 'settings-section stats-card stats-wide');
    card.append(el('h2', 'settings-heading', 'Your palette (favorites)'));
    if (!s.palette.length) card.append(el('p', 'settings-desc', 'Favorite some entries with screenshots to see the colors you keep choosing.'));
    const strip = el('div', 'stats-palette');
    for (const hex of s.palette) {
      const sw = el('span', 'stats-swatch');
      sw.style.background = hex;
      sw.title = hex;
      strip.append(sw);
    }
    card.append(strip);
    root.append(card);
  }
}
