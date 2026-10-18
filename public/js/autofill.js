// Guesses for the Add form's fashion fields from what /api/unfurl found.
// Pure functions (lists passed in) so they stay easy to reason about.

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// A known brand wins (so "Bronson Mfg. Co." lands on your "Bronson MFG"); then
// the brand you used on earlier entries from the same shop; then the page's own.
export function guessBrand(info, url, entries) {
  const known = [...new Set(entries.map(e => e.brand).filter(Boolean))];
  const candidates = [info.brand, info.siteName].filter(Boolean);
  for (const c of candidates) {
    const n = norm(c);
    const hit = n.length >= 3 && known.find(k => { const m = norm(k); return m.length >= 3 && (n.includes(m) || m.includes(n)); });
    if (hit) return hit;
  }
  const host = hostOf(url);
  const prior = entries.filter(e => e.brand && hostOf(e.url) === host);
  // ponytail: a shop that has only ever carried one brand for us; mixed retailers fall through.
  if (prior.length >= 2 && new Set(prior.map(e => e.brand)).size === 1) return prior[0].brand;
  return candidates[0] || '';
}

const COLOR_ALIASES = {
  Gray: ['grey'], Blue: ['navy', 'indigo'], Green: ['olive'], Red: ['burgundy', 'maroon'],
  White: ['cream', 'ivory'], Brown: ['tan']
};
const variants = (name, extra = []) => [name, name.replace(/s$/, ''), name + 's', ...extra];

// The one option whose name appears in the first source that mentions exactly
// one option. Sources are ordered most- to least-trustworthy; a source that
// mentions two options ("shirt jacket") is skipped rather than guessed at.
export function guessOption(options, sources, aliases = {}) {
  for (const text of sources) {
    if (!text) continue;
    const hits = options.filter(o =>
      variants(o, aliases[o]).some(w => new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(text)));
    if (hits.length === 1) return hits[0];
  }
  return '';
}

export function guessFashionFields(info, url, { entries, types, colors }) {
  const brand = guessBrand(info, url, entries);
  let path = '';
  try { path = decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, ' '); } catch { /* keep '' */ }
  // Don't let the brand read as a color or type ("Red Wing").
  const scrub = s => (brand && s ? s.replace(new RegExp(escapeRe(brand), 'gi'), ' ') : s);
  const sources = first => [first, scrub(info.title), scrub(path)];
  const price = info.price && (!info.currency || info.currency === 'USD' ? info.price : `${info.currency} ${info.price}`);
  return {
    brand,
    price: price || '',
    type: guessOption(types, sources(info.category)),
    color: guessOption(colors, sources(info.color), COLOR_ALIASES)
  };
}
