// Guesses for the Add form's fashion fields from what /api/unfurl found.
// Pure functions (lists passed in) so they stay easy to reason about.

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

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
// `ambiguous` is the most options any source mentioned when none gave a single answer.
function scanOption(options, sources, aliases = {}) {
  let ambiguous = 0;
  for (const text of sources) {
    if (!text) continue;
    const hits = options.filter(o =>
      variants(o, aliases[o]).some(w => new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(text)));
    if (hits.length === 1) return { value: hits[0], ambiguous: 0 };
    ambiguous = Math.max(ambiguous, hits.length);
  }
  return { value: '', ambiguous };
}

export const guessOption = (options, sources, aliases) => scanOption(options, sources, aliases).value;

export function guessFashionFields(info, url, { entries, types, colors }) {
  const brand = guessBrand(info, url, entries);
  let path = '';
  try { path = decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, ' '); } catch { /* keep '' */ }
  // Don't let the brand read as a color or type ("Red Wing").
  const scrub = s => (brand && s ? s.replace(new RegExp(escapeRe(brand), 'gi'), ' ') : s);
  const sources = first => [first, scrub(info.title), scrub(path)];
  const whole = info.price && Math.round(Number(info.price)); // whole dollars: $49.99 -> $50
  const price = whole && (!info.currency || info.currency === 'USD' ? whole : `${info.currency} ${whole}`);
  const type = scanOption(types, sources(info.category));
  const color = scanOption(colors, sources(info.color), COLOR_ALIASES);
  return {
    brand,
    price: price || '',
    type: type.value,
    color: color.value,
    // Fields left blank because the page matched several options, with how many: "color (2 matches)".
    skipped: { ...(type.ambiguous > 1 && { type: type.ambiguous }), ...(color.ambiguous > 1 && { color: color.ambiguous }) }
  };
}

// "Found via" for links from the usual inspiration sites, matched against your own list.
export function guessFoundVia(url, options) {
  const m = hostOf(url).match(/(?:^|\.)(pinterest|dribbble|instagram|reddit)\./);
  return (m && options.find(o => o.toLowerCase() === m[1])) || '';
}

// What you changed after autofill, remembered per shop: { host: { type: { guessed: yours } } }.
// A later guess that equals one you corrected before is swapped for your value.
const CORRECTED = ['type', 'color'];

export function applyCorrections(guess, url, corrections) {
  const mine = corrections[hostOf(url)] || {};
  const out = { ...guess };
  for (const k of CORRECTED) if (guess[k] && mine[k]?.[guess[k]]) out[k] = mine[k][guess[k]];
  return out;
}

// raw = the guess, filled = what autofill wrote, final = what was saved.
export function recordCorrections(raw, filled, final, url, corrections) {
  const host = hostOf(url);
  for (const k of CORRECTED) {
    if (raw[k] && filled[k] && final[k] && final[k] !== filled[k]) ((corrections[host] ??= {})[k] ??= {})[raw[k]] = final[k];
  }
  return corrections;
}

// ─── Page titles ─────────────────────────────────────────────────────────────
// "Pricing | Stripe" or "Dashboard - Linear" → "Pricing" / "Dashboard", when the tail names the site (og:site_name or a label of the host).
export function cleanTitle(title, siteName, url) {
  const m = title.match(/^(.*\S)\s+[|\-–—·•]\s+([^|\-–—·•]+)$/);
  if (!m) return title;
  const [, head, tail] = m;
  const t = norm(tail);
  const labels = hostOf(url).split('.').slice(0, -1).map(norm).filter(l => l.length >= 3);
  const names = siteName && norm(siteName).length >= 3 ? [norm(siteName)] : [];
  return head.length >= 3 && t && [...labels, ...names].some(n => t.includes(n) || n.includes(t)) ? head : title;
}

// ─── Autofill report per shop ────────────────────────────────────────────────
// { host: { runs, missing: { color: 4 } } }: how often a field came back empty from each shop, kept in localStorage.
export function recordReport(report, url, fields) {
  const host = hostOf(url);
  if (!host) return report;
  const row = (report[host] ??= { runs: 0, missing: {} });
  row.runs++;
  for (const [field, value] of Object.entries(fields)) if (!value) row.missing[field] = (row.missing[field] || 0) + 1;
  return report;
}

// "bronsonshop.com: color missing 4/15", busiest shops first; shops where nothing was ever missing are left out.
export function reportLines(report, limit = 8) {
  return Object.entries(report)
    .filter(([, r]) => Object.keys(r.missing).length)
    .sort((a, b) => b[1].runs - a[1].runs || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([host, r]) => `${host}: ${Object.entries(r.missing).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} missing ${n}/${r.runs}`).join(', ')}`);
}
