'use strict';

// Fetching a page for the Add form: title, image, price and the other autofill hints.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { UPLOADS_DIR } = require('./store');
const { ALLOWED_IMAGE_TYPES, attachScreenshot } = require('./images');
const { httpError, cleanHttpUrl } = require('./validate');

const router = express.Router();

// ─── Page info (auto-fill from URL) ───────────────────────────────────────────
// Fetches with a timeout and a size cap. `truncate` keeps what was read when the
// cap is hit (fine for HTML, where <head> comes first); otherwise it's an error.
const BOT_UA = 'Mozilla/5.0 (compatible; Omniview/1.0)';
// Shops block unknown bots; a 403/429 is retried once as a desktop browser.
// Bump the version now and then: a very old one is itself a bot signal.
const CHROME_VERSION = '130.0.0.0';
const BROWSER_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

// One request per second to the same host: pasting twenty links from one shop in a row
// is exactly what gets an address blocked. Each caller books the next free second.
// Local addresses are exempt (nothing to be polite to, and it keeps tests fast).
const hostSlots = new Map();
async function politeWait(url) {
  const { hostname } = new URL(url);
  if (/^(localhost|127\.|\[::1\])/.test(hostname)) return;
  const slot = Math.max(Date.now(), (hostSlots.get(hostname) ?? 0) + 1000);
  hostSlots.set(hostname, slot);
  if (slot > Date.now()) await new Promise(r => setTimeout(r, slot - Date.now()));
}

async function fetchCapped(url, { maxBytes, truncate }) {
  await politeWait(url);
  const get = userAgent => fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': userAgent, accept: '*/*' } });
  let res = await get(BOT_UA);
  if (res.status === 403 || res.status === 429) res = await get(BROWSER_UA);
  if (res.status === 403 || res.status === 429) throw httpError(502, 'This site blocked the preview');
  if (!res.ok) throw httpError(502, `The site answered ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) {
      if (truncate) break;
      throw httpError(502, 'That file is too large');
    }
    chunks.push(chunk);
  }
  return { type, buffer: Buffer.concat(chunks), finalUrl: res.url };
}

// Numeric forms (decimal and hex) plus the named entities that turn up in page titles.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', deg: '°',
  eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á', ouml: 'ö', uuml: 'ü', auml: 'ä', ntilde: 'ñ', ccedil: 'ç',
  euro: '€', pound: '£', yen: '¥', cent: '¢', times: '×', laquo: '«', raquo: '»'
};
// One pass, so "&amp;lt;" becomes "&lt;" and not "<".
const decodeEntities = s => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi, (m, dec, hex, name) => {
  if (name) return NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m;
  const cp = dec ? +dec : parseInt(hex, 16);
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3]);
  return out;
}

// The first schema.org Product (or ProductGroup) in the page's JSON-LD, if any.
// Scans the whole document: shop pages often put it far past the <head>.
function productNode(html) {
  let found = null;
  const walk = n => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if ([].concat(n['@type'] || []).some(t => /^Product(Group)?$/.test(t))) { found = n; return; }
    walk(n['@graph']);
  };
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* malformed JSON-LD is common; skip it */ }
    if (found) break;
  }
  return found;
}

// Some shops write the currency as a symbol instead of an ISO code. ¥ is left out: it is JPY or CNY.
const CURRENCY_CODES = { '$': 'USD', '£': 'GBP', '€': 'EUR', '₹': 'INR' };

// Shops serve one picture at several sizes: Shopify `_300x.jpg`, WordPress `-300x300.jpg`, `?width=300`.
const SIZE_SUFFIX = /[_-]\d{2,4}x(?:\d{2,4})?(?=[.@_])/;
const MIN_COVER_PX = 200;
const sizeKey = u => { const x = new URL(u); return x.host + x.pathname.replace(SIZE_SUFFIX, ''); };
function sizeHint(u) {
  const x = new URL(u);
  const w = Number(x.searchParams.get('width') || x.searchParams.get('w')) || Number((x.pathname.match(/[_-](\d{2,4})x(?:\d{2,4})?(?=[.@_])/) || [])[1]);
  return w || Infinity; // no size in the URL: assume it is the original
}

function pageInfo(html, baseUrl) {
  const meta = {};
  const ogImages = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(tag);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content.trim();
    if (/^(og|twitter):image(:url)?$/.test(key) && a.content) ogImages.push(a.content.trim());
  }
  const abs = href => {
    try {
      const u = new URL(href, baseUrl);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch { return null; }
  };
  let favicon = null;
  let canonical = null;
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(tag);
    if (a.href && /\bicon\b/i.test(a.rel || '')) favicon ??= abs(a.href);
    if (a.href && /\bcanonical\b/i.test(a.rel || '')) canonical ??= abs(a.href);
  }
  canonical ??= meta['og:url'] ? abs(meta['og:url']) : null;
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const theme = (meta['theme-color'] || '').match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

  const product = productNode(html) || {};
  const text = v => (typeof v === 'string' ? v : v && typeof v.name === 'string' ? v.name : '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const first = v => [].concat(v ?? [])[0];
  const offer = first(product.offers) || first(first(product.hasVariant)?.offers) || {};
  const spec = first(offer.priceSpecification) || {}; // an object or a list of them
  // Small shops often have no JSON-LD, only microdata (<span itemprop="price" content="12">) or a data-price attribute.
  // ponytail: first match wins, and data-price is assumed to be in whole currency units (not cents).
  const microTag = html.match(/<[a-z][^>]*\bitemprop=["']price["'][^>]*>/i);
  const microPrice = microTag ? attrs(microTag[0]).content : undefined;
  const dataPrice = (html.match(/\bdata-price=["'](\d+(?:\.\d{1,2})?)["']/i) || [])[1];
  let rawPrice = offer.price ?? offer.lowPrice ?? spec.price ?? meta['og:price:amount'] ?? meta['product:price:amount'] ?? microPrice ?? dataPrice;
  // A price written with its symbol ("$129.99") gives the currency too.
  let symbol = null;
  const symbolic = typeof rawPrice === 'string' && rawPrice.trim().match(/^([$£€₹])\s*(\d[\d,]*(?:\.\d+)?)$/);
  if (symbolic) { symbol = symbolic[1]; rawPrice = symbolic[2].replace(/,/g, ''); }
  const price = Number(rawPrice);
  const currency = text(offer.priceCurrency || spec.priceCurrency || meta['og:price:currency'] || meta['product:price:currency'] || meta.pricecurrency) || symbol || '';
  const availability = text(offer.availability || meta['product:availability'] || meta['og:availability'] || meta.availability).replace(/^.*schema\.org\//i, '');
  // JSON-LD image URLs are sloppy ("https:files/x.jpg"); only take ones that are clearly URLs.
  const ldImages = [].concat(product.image ?? []).map(i => (typeof i === 'string' ? i : i?.url)).filter(i => /^(https?:)?\/\//.test(i) || /^\/[^/]/.test(i));
  // The same picture shows up as http/https, with ?v= params, or at several sizes; keep the largest of each.
  const byKey = new Map();
  for (const u of [...ogImages, ...ldImages].map(abs).filter(Boolean)) {
    const k = sizeKey(u);
    if (!byKey.has(k) || sizeHint(u) > sizeHint(byKey.get(k))) byKey.set(k, u);
  }
  const candidates = [...byKey.values()].slice(0, 8);
  // The default cover is the first one that is not obviously a logo or sprite.
  const cover = candidates.find(u => sizeHint(u) >= MIN_COVER_PX) || candidates[0] || null;
  const images = cover ? [cover, ...candidates.filter(u => u !== cover)] : [];

  return {
    title: (meta['og:title'] || meta['twitter:title'] || (titleTag ? decodeEntities(titleTag[1]) : '')).replace(/\s+/g, ' ').trim().slice(0, 300),
    image: cover,
    images,
    canonical,
    favicon: favicon || abs('/favicon.ico'),
    themeColor: theme ? '#' + (theme[1].length === 3 ? [...theme[1]].map(c => c + c).join('') : theme[1]).toLowerCase() : null,
    brand: text(product.brand) || text(meta['product:brand']) || text(meta['og:brand']) || null,
    siteName: text(meta['og:site_name']) || null,
    price: rawPrice !== '' && rawPrice != null && Number.isFinite(price) && price > 0 ? String(+price.toFixed(2)) : null,
    currency: CURRENCY_CODES[currency] || currency.toUpperCase() || null,
    availability: availability || null,
    color: text(product.color) || null,
    category: text(product.category) || text(meta['product:category']) || text(meta['og:product:category']) || null
  };
}

const BOT_WALL_TITLE = /^(just a moment|access denied|attention required|are you a (human|robot)|robot or human|please verify|security check)|captcha/i;

// Answers are kept for 10 minutes so re-pasting a link, or pressing Refresh price right
// after an edit, doesn't fetch the shop again. Failures are not cached.
const UNFURL_TTL = 10 * 60 * 1000;
const unfurlCache = new Map();

router.get('/api/unfurl', async (req, res) => {
  const url = cleanHttpUrl(typeof req.query.url === 'string' ? req.query.url : '', 'url');
  const cached = unfurlCache.get(url);
  if (cached && Date.now() - cached.at < UNFURL_TTL) return res.json(cached.info);
  let page;
  try {
    page = await fetchCapped(url, { maxBytes: 4 * 1024 * 1024, truncate: true });
  } catch (err) {
    throw err.status ? err : httpError(502, 'Could not reach that site');
  }
  if (!/html/.test(page.type)) throw httpError(502, 'That URL is not a web page');
  const info = pageInfo(page.buffer.toString('utf8'), page.finalUrl);
  // Some walls answer 200 with a challenge page; its title would otherwise land in the form.
  if (BOT_WALL_TITLE.test(info.title)) throw httpError(502, 'This site blocked the preview');
  unfurlCache.set(url, { at: Date.now(), info });
  if (unfurlCache.size > 100) unfurlCache.delete(unfurlCache.keys().next().value);
  res.json(info);
});

// Downloads an image from a URL (e.g. the page's og:image) and attaches it like an upload.
router.post('/api/entries/:id/screenshot-url', async (req, res) => {
  const url = cleanHttpUrl(req.body.url, 'url');
  let img;
  try {
    img = await fetchCapped(url, { maxBytes: 15 * 1024 * 1024, truncate: false });
  } catch (err) {
    throw err.status ? err : httpError(502, 'Could not download that image');
  }
  const ext = ALLOWED_IMAGE_TYPES[img.type];
  if (!ext) throw httpError(400, 'Only PNG, JPEG, WEBP, GIF, or AVIF images are allowed');
  const file = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), img.buffer);
  const { entry, duplicateOf } = await attachScreenshot(req.params.id, file, true);
  res.json({ screenshot: file, screenshots: entry.screenshots, duplicateOf });
});

module.exports = router;
router.pageInfo = pageInfo;
router.politeWait = politeWait;
