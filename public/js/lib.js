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
