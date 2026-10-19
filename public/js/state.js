// Shared app state, constants, and small pure helpers.

import { priceOf, isBought, formatTotal } from './lib.js';
export { priceOf, isBought };

// Separate libraries on one server ('ui' design inspiration, 'fashion' wishlist, and
// whatever else server.js defines). The server picks one per request from the X-Space
// header (api.js). name → label; replaced with the server's list at boot (loadSpaces).
export const SPACES = { ui: 'UI', fashion: 'Fashion' };
// Parts of the UI a library does without ({ foundVia: false }), and the server's limits; both filled at boot (main.js).
export const FEATURES = {};
export const config = { maxScreenshots: 10 };
export const hasFoundVia = () => FEATURES[state.space]?.foundVia !== false;
// Fashion starts with bought items hidden; the UI space has no such flag.
export const defaultFilters = (space = 'ui') => ({ q: '', type: '', tags: [], board: '', color: '', brand: '', shop: '', via: '', added: '', from: '', to: '', favorite: false, hideBought: space === 'fashion', tagMode: 'any' });

export const state = {
  space: localStorage.getItem('omniview-space') || 'ui', // checked against the server's list at boot
  view: 'browse',
  layout: 'gallery',   // gallery | masonry | list; per space, set by loadPersistedFilters
  entries: [],
  boards: [],
  tags: [],
  types: [],
  foundVia: [],
  filters: defaultFilters(),
  sort: 'newest',
  group: '',           // '' | month | type | brand | tag | board
  cardSize: 220,       // min card width in px
  bulkMode: false,
  selectedIds: new Set(),
  selectAnchorId: null,
  navIds: [],          // entry ids in on-screen order, for prev/next in the detail modal
  currentBoard: null,
  // Add form
  formTags: [],        // mutated in place, never reassigned (the tag input holds a reference)
  formBoards: new Set(),
  pending: [],         // screenshots queued for the entry being added: { file?, url?, preview }
  pageInfo: null,      // result of the last auto-fill: { favicon, forUrl }
  allowDuplicate: false,
  // Detail modal
  detailEntry: null,
  detailTags: [],
  detailBoards: new Set(),
  detailShot: 0,
  sinceOpen: 0,        // when the app was last opened before this session (ms), for the "new" dot; 0 = first run
};

// ─── Colors ──────────────────────────────────────────────────────────────────
// Named colors for the manual Color field and the swatch filter.
export const COLORS = {
  Black: '#111111', White: '#f5f5f5', Gray: '#8a8a8a', Red: '#e5484d', Orange: '#f76b15', Yellow: '#f5d90a',
  Green: '#30a46c', Blue: '#3e63dd', Purple: '#8e4ec6', Pink: '#e93d82', Brown: '#8d6e4c',
  Multicolor: 'conic-gradient(#e5484d, #f5d90a, #30a46c, #3e63dd, #8e4ec6, #e5484d)'
};
export const COLOR_NAMES = Object.keys(COLORS);

// Nearest named color for a palette hex (HSL buckets, good enough for filtering).
export function colorName(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(h => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (l < 0.12) return 'Black';
  if (l > 0.92) return 'White';
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15) return l < 0.3 ? 'Black' : l > 0.8 ? 'White' : 'Gray';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return l > 0.7 ? 'Pink' : 'Red';
  if (h < 45) return l < 0.4 ? 'Brown' : 'Orange';
  if (h < 70) return 'Yellow';
  if (h < 165) return 'Green';
  if (h < 255) return 'Blue';
  if (h < 300) return 'Purple';
  return 'Pink';
}

// ─── Icons ───────────────────────────────────────────────────────────────────
// Blank-image mark shown wherever an entry has no uploaded screenshot.
export const PLACEHOLDER_SVG = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="2" y="5" width="24" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="12" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M2 19l7-5 4 3.5 3.5-2.5 9.5 6" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';


export const OPEN_ICON = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 2H2v9h9V8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 1.5H11.5V5.5M11.5 1.5L6 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function cleanUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Only http(s) URLs may become an href: a stored `javascript:` URL would run
// script in the app's origin when clicked.
export function isHttpUrl(url) {
  try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; }
}
export function safeHref(url) { return isHttpUrl(url) ? url : ''; }

// The ~600px WebP the server generates next to every upload.
export const thumbUrl = file => `/uploads/thumbs/${file.replace(/\.[^.]+$/, '.webp')}`;

// <img> that loads the thumbnail and falls back to the original if it's missing.
export function thumbImg(file, alt = '') {
  const img = document.createElement('img');
  img.src = thumbUrl(file);
  img.alt = alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => { img.src = `/uploads/${file}`; }, { once: true });
  return img;
}

export function titleOf(e) { return e.title || cleanUrl(e.url); }

// The cover image (first screenshot) of an entry, or undefined.
export const coverOf = e => e.screenshots[0];

// "Acme · $120 (was $150)" under a fashion entry's name (any part may be missing).
export const brandPrice = e => [e.brand, e.price && (e.price_was && e.price_was !== e.price ? `${e.price} (was ${e.price_was})` : e.price)].filter(Boolean).join(' · ');

// How much a price fell since the last Refresh price ("▼ $20"), or '' when it did not fall.
export const priceDrop = e => {
  const now = priceOf(e), was = priceOf({ price: e.price_was });
  return now !== null && was !== null && now < was ? `▼ $${Math.round(was - now)}` : '';
};

// "$1,420" for a fashion list, '' in the UI space. Prices in another currency are not added in.
export const priceTotal = entries => (state.space === 'fashion' ? formatTotal(entries) : '');

// Per-space localStorage key, so each library remembers its own filters, layout and drafts.
export const spaceKey = base => (state.space === 'ui' ? base : `${base}-${state.space}`);

// A board's name with its emoji, when it has one.
export const boardLabel = b => (b.emoji ? `${b.emoji} ` : '') + b.name;

export const byName = (a, b) => a.localeCompare(b);

// Small site icon from the page's <link rel="icon">. Hidden if it fails to load.
export function faviconImg(url) {
  const img = document.createElement('img');
  img.className = 'favicon';
  img.src = url;
  img.alt = '';
  img.width = img.height = 14;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}
