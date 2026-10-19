// Pure helpers (no DOM, no state) so `node --test` can import them.

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// Mean distance from each color of `from` to its nearest color in `to`.
const nearest = (from, to) =>
  from.reduce((sum, c) => sum + Math.min(...to.map(d => Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]))), 0) / from.length;

// 0..1, symmetric. Plain RGB distance: Lab would be the upgrade if neighbours ever look off.
export function paletteSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const pa = a.map(rgb), pb = b.map(rgb);
  return 1 - (nearest(pa, pb) + nearest(pb, pa)) / 2 / Math.hypot(255, 255, 255);
}

// How alike two entries are: palette (UI only, fashion backdrops are white), shared tags, same type, same color name.
export function similarity(a, b, usePalette) {
  const tags = new Set(a.style_tags);
  const union = new Set([...tags, ...b.style_tags]);
  const jaccard = union.size ? b.style_tags.filter(t => tags.has(t)).length / union.size : 0;
  return (usePalette ? paletteSimilarity(a.palette, b.palette) * 0.6 : 0)
    + jaccard * 0.3
    + (a.type && a.type === b.type ? 0.1 : 0)
    + (a.color && a.color === b.color ? 0.1 : 0);
}

export function moreLike(entry, entries, usePalette, n = 6) {
  return entries
    .filter(e => e.id !== entry.id)
    .map(e => ({ e, score: similarity(entry, e, usePalette) }))
    .filter(x => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, n)
    .map(x => x.e);
}

// Date-added filter: 'week' (since Monday), 'month' (since the 1st), or 'custom' (from/to as YYYY-MM-DD, inclusive).
export function inAddedRange(iso, { added, from, to }, now = new Date()) {
  const t = new Date(iso);
  if (added === 'custom') {
    const end = to ? new Date(to + 'T00:00') : null;
    if (end) end.setDate(end.getDate() + 1);
    return (!from || t >= new Date(from + 'T00:00')) && (!end || t < end);
  }
  const start = new Date(now.getFullYear(), now.getMonth(), added === 'month' ? 1 : now.getDate());
  if (added === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return t >= start;
}

// "3 days ago", "just now"; `now` is injectable for tests.
export function timeAgo(iso, now = new Date()) {
  const s = Math.round((now - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  for (const [unit, secs] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
}

// Entries in a board's manual order; anything not in `order` keeps its relative position after them.
export function orderEntries(entries, order) {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...entries].sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length));
}

// ─── Tag suggestions, aliases, near-duplicates ───────────────────────────────
const hsl = hex => {
  const [r, g, b] = rgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return { h, s, l, chroma: d };
};

// Style-tag names a palette (dominant color first) points to. Only ever offered, never applied.
export function suggestTags(palette) {
  if (!palette.length) return [];
  const colors = palette.map(hsl);
  const out = [];
  if (colors[0].l < 0.25) out.push('Dark Mode');
  else if (colors[0].l > 0.75) out.push('Light Mode');
  if (colors.every(c => c.chroma < 0.08)) out.push('Monochrome');
  // Colorful: at least three clearly saturated colors that are not all the same hue.
  const vivid = colors.filter(c => c.s > 0.4 && c.l > 0.15 && c.l < 0.9);
  if (vivid.length >= 3 && Math.max(...vivid.map(c => c.h)) - Math.min(...vivid.map(c => c.h)) > 60) out.push('Colorful');
  return out;
}

// Up to 5 dominant colors (#rrggbb) of RGBA pixel data, like the server's extractPalette (4-bit buckets).
export function dominantColors(rgba) {
  const buckets = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, c: [0, 0, 0] };
    b.n++; for (let k = 0; k < 3; k++) b.c[k] += rgba[i + k];
    buckets.set(key, b);
  }
  const picked = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const c = b.c.map(v => v / b.n);
    if (picked.every(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 48)) picked.push(c);
    if (picked.length === 5) break;
  }
  return picked.map(c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
}

// Words that should lead to a tag even though they aren't part of its name.
export const TAG_ALIASES = {
  'Dark Mode': ['dark', 'night', 'black'],
  'Light Mode': ['light', 'bright', 'white'],
  Monochrome: ['mono', 'bw', 'grayscale', 'greyscale'],
  Minimal: ['minimalist', 'simple'],
  Colorful: ['color', 'colour', 'vibrant', 'rainbow'],
  Gradient: ['gradients', 'ombre'],
  Typographic: ['type', 'typography', 'font'],
  Retro: ['vintage', 'old school'],
  Futuristic: ['future', 'scifi', 'sci-fi'],
  Bold: ['loud', 'strong'],
  Muted: ['pastel', 'soft']
};

// Does `tag` answer to the typed text `q` (its name, or a word listed as an alias)?
export const tagMatches = (tag, q, aliases = TAG_ALIASES) => {
  q = q.trim().toLowerCase();
  return !q || tag.toLowerCase().includes(q) || (aliases[tag] || []).some(a => a.startsWith(q));
};

const stem = s => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies|y)$/, 'i').replace(/(es|s)$/, '');

// An existing tag that is nearly the same as `name` (plural, a prefix like Minimal/Minimalist, a one-letter typo), or null.
export function similarTag(name, tags) {
  const a = stem(name);
  if (!a) return null;
  return tags.find(t => {
    const b = stem(t);
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length >= 4 && long.startsWith(short) && long.length - short.length <= 4) return true;
    return short.length >= 5 && long.length === short.length && [...short].filter((c, i) => c !== long[i]).length === 1;
  }) || null;
}

// ─── Stats ───────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// [name, count] pairs, most used first (ties alphabetical), blanks skipped.
const top = (names, n) => {
  const counts = new Map();
  for (const x of names) if (x) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
};

// Everything the Stats page shows. `months` is the number of calendar months ending at `now`
// (empty ones included, so gaps are visible). `palette` merges the palettes of favorites
// into the colors they use most, skipping near-duplicates like the per-entry palette does.
export function libraryStats(entries, now = new Date(), months = 12) {
  const perMonth = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()], n: 0 };
  });
  const byKey = new Map(perMonth.map(m => [m.key, m]));
  for (const e of entries) {
    const d = new Date(e.date_added);
    const m = byKey.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    if (m) m.n++;
  }
  const colors = top(entries.filter(e => e.favorite).flatMap(e => e.palette.map(c => c.toLowerCase())), Infinity);
  const palette = [];
  for (const [hex] of colors) {
    const c = rgb(hex);
    if (palette.every(p => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) > 48)) palette.push(c);
    if (palette.length === 10) break;
  }
  return {
    total: entries.length,
    perMonth,
    tags: top(entries.flatMap(e => e.style_tags), 8),
    via: top(entries.map(e => e.found_via), 8),
    types: top(entries.map(e => e.type), 8),
    palette: palette.map(c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''))
  };
}

// ─── Prices ──────────────────────────────────────────────────────────────────
const NUMBER = '(\\d[\\d,]*(?:\\.\\d+)?)';
const NEXT_TO_CURRENCY = new RegExp(`(?:[$£€¥₹]|\\b[A-Z]{3}\\b)\\s?${NUMBER}`);

// The number in a free-text price. One written next to a currency symbol or code wins
// ("2 for $100" is 100, "from $90 to $120" is 90); otherwise the first number.
export function priceOf(entry) {
  const text = String(entry.price ?? '');
  const m = text.match(NEXT_TO_CURRENCY) || text.match(new RegExp(NUMBER));
  const n = m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
}

// 'USD' for a bare number or "$"; otherwise the symbol or code the price is written in ("EUR", "£").
export function currencyOf(entry) {
  const m = String(entry.price ?? '').match(/[£€¥₹]|\b[A-Z]{3}\b/);
  return m ? m[0] : 'USD';
}

// Dollar total of the bare/USD prices, plus how many priced entries were left out for being in another currency.
export function priceSum(entries) {
  let total = 0;
  let other = 0;
  for (const e of entries) {
    const n = priceOf(e);
    if (n === null) continue;
    if (currencyOf(e) === 'USD') total += n; else other++;
  }
  return { total, other };
}

export const money = n => '$' + Math.round(n).toLocaleString('en-US');

// "$1,420" or "$1,420 + 1 in another currency".
export function formatTotal(entries) {
  const { total, other } = priceSum(entries);
  return money(total) + (other ? ` + ${other} in another currency` : '');
}

// Bought via the flag, or the older "bought" tag convention.
export const isBought = e => e.bought || e.style_tags.some(t => t.toLowerCase() === 'bought');

// What the Fashion stats page shows. Averages and the spread use the wishlist's USD prices only.
export function fashionStats(entries) {
  const wanted = entries.filter(e => !isBought(e));
  const bought = entries.filter(isBought);
  const prices = wanted.filter(e => currencyOf(e) === 'USD').map(priceOf).filter(n => n !== null);
  return {
    wishlist: { count: wanted.length, ...priceSum(wanted) },
    bought: { count: bought.length, ...priceSum(bought) },
    average: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    brands: top(entries.map(e => e.brand), 10)
  };
}

// ─── Fuzzy search ────────────────────────────────────────────────────────────
// True when a and b are at most one edit apart (a character added, dropped or changed).
export function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || a === b;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.slice(i) === long.slice(i + 1);
}

// Fallback for a search that found nothing: every word typed (3+ letters) is within one edit of a word in the title or brand.
export function fuzzyMatch(entry, q) {
  const words = `${entry.title} ${entry.brand || ''}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const typed = q.toLowerCase().split(/\s+/).filter(Boolean);
  return typed.length > 0 && typed.every(t => t.length >= 3 && words.some(w => withinOneEdit(w, t)));
}
