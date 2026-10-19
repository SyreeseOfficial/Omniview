'use strict';

// Smoke tests over the real HTTP API, backed by a throwaway db/uploads dir
// so they never touch the real library. Run with `npm test` (node --test).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniview-test-'));
process.env.OMNIVIEW_DB_PATH = path.join(tmpDir, 'library.json');
process.env.OMNIVIEW_UPLOADS_DIR = path.join(tmpDir, 'uploads');
const UPLOADS = process.env.OMNIVIEW_UPLOADS_DIR;

const app = require('../server.js');

let server, base;

before(() => new Promise(resolve => {
  server = app.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(async () => {
  await app.flushDB();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const GUARD = { 'X-Omniview': '1' };

// `space` picks the library ('ui' when omitted, like a request with no X-Space header).
async function call(method, urlPath, body, space) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...GUARD, ...(space && { 'X-Space': space }) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

const create = async (url, extra = {}, space) => (await call('POST', '/api/entries', { url, ...extra }, space)).body.entry;

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function upload(id, type = 'image/png', data = PNG_1PX, space) {
  const form = new FormData();
  form.append('screenshot', new Blob([data], { type }), 'shot');
  const res = await fetch(`${base}/api/entries/${id}/screenshot`, { method: 'POST', headers: { ...GUARD, ...(space && { 'X-Space': space }) }, body: form });
  return { status: res.status, body: await res.json() };
}

// ─── Entries ─────────────────────────────────────────────────────────────────
test('create, update, and delete an entry', async () => {
  const entry = await create('https://example.com');
  const id = entry.id;

  const update = await call('PUT', `/api/entries/${id}`, { title: 'Example' });
  assert.equal(update.status, 200);
  assert.equal(update.body.title, 'Example');

  const del = await call('DELETE', `/api/entries/${id}`);
  assert.equal(del.status, 200);

  const list = await call('GET', '/api/entries');
  assert.equal(list.body.find(e => e.id === id), undefined);
});

test('unknown entry id returns 404', async () => {
  const res = await call('GET', '/api/entries/does-not-exist');
  assert.equal(res.status, 404);
});

test('writes validate types and URL scheme', async () => {
  assert.equal((await call('POST', '/api/entries', { url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call('POST', '/api/entries', { url: 'https://valid.example', style_tags: 'x' })).status, 400);
  const entry = await create('https://valid2.example');
  assert.equal((await call('PUT', `/api/entries/${entry.id}`, { favorite: 'yes' })).status, 400);
  assert.equal((await call('PUT', `/api/entries/${entry.id}`, { url: 'ftp://nope' })).status, 400);
  await call('DELETE', `/api/entries/${entry.id}`);
});

test('unknown tags and types on an entry are registered', async () => {
  const entry = await create('https://register.example', { style_tags: ['AutoTag'], type: 'AutoType' });
  assert.ok((await call('GET', '/api/tags')).body.includes('AutoTag'));
  assert.ok((await call('GET', '/api/types')).body.includes('AutoType'));
  await call('DELETE', `/api/entries/${entry.id}`);
});

test('duplicate URLs are refused unless forced, ignoring www/scheme/tracking', async () => {
  const first = await create('https://www.Dupe.example/page/?utm_source=x#frag');
  const again = await call('POST', '/api/entries', { url: 'http://dupe.example/page' });
  assert.equal(again.status, 409);
  assert.equal(again.body.duplicate.id, first.id);

  const check = await call('GET', `/api/duplicate?url=${encodeURIComponent('https://dupe.example/page')}`);
  assert.equal(check.body.duplicate.id, first.id);

  const forced = await call('POST', '/api/entries', { url: 'http://dupe.example/page', force: true });
  assert.equal(forced.status, 201);
  assert.equal(forced.body.isDuplicate, true);
  await call('POST', '/api/entries/bulk', { ids: [first.id, forced.body.entry.id], action: 'delete' });
});

test('concurrent creates are all kept', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '/api/entries', { url: `https://concurrent.example/${i}` })));
  assert.ok(results.every(r => r.status === 201));
  const ids = results.map(r => r.body.entry.id);
  const list = (await call('GET', '/api/entries')).body;
  assert.equal(ids.filter(id => list.some(e => e.id === id)).length, 20);
  await call('POST', '/api/entries/bulk', { ids, action: 'delete' });
});

// ─── Spaces (ui / fashion) ───────────────────────────────────────────────────
// Uploads are shared between spaces, so the orphan sweep must look at every
// space's entries or using one space would delete the other's screenshots.
test('cleanup run from one space keeps the other space\'s screenshots', async () => {
  const fashion = await create('https://sweep-fashion.example', {}, 'fashion');
  const ui = await create('https://sweep-ui.example');
  const fashionShot = (await upload(fashion.id, 'image/png', PNG_1PX, 'fashion')).body.screenshot;
  const uiShot = (await upload(ui.id)).body.screenshot;
  assert.ok(fashionShot && uiShot, 'uploads into both spaces succeed');

  await call('POST', '/api/cleanup'); // from the UI space
  assert.ok(fs.existsSync(path.join(UPLOADS, fashionShot)), 'fashion screenshot survives a UI cleanup');
  await call('POST', '/api/cleanup', {}, 'fashion');
  assert.ok(fs.existsSync(path.join(UPLOADS, uiShot)), 'UI screenshot survives a fashion cleanup');
  assert.ok(fs.existsSync(path.join(UPLOADS, 'thumbs', fashionShot.replace(/\.png$/, '.webp'))));

  await call('DELETE', `/api/entries/${fashion.id}`, undefined, 'fashion');
  await call('DELETE', `/api/entries/${ui.id}`);
});

test('spaces keep separate entries, tags, types, boards and found-via lists', async () => {
  const fashionDefaults = (await call('GET', '/api/types', undefined, 'fashion')).body;
  assert.ok(fashionDefaults.includes('Jacket') && !fashionDefaults.includes('Website'));
  assert.deepEqual((await call('GET', '/api/tags', undefined, 'fashion')).body, [], 'fashion starts with no style tags');
  assert.ok(!(await call('GET', '/api/types')).body.includes('Jacket'));

  const f = await create('https://iso-fashion.example', { style_tags: ['Boxy'], type: 'Jacket' }, 'fashion');
  const board = (await call('POST', '/api/boards', { name: 'Winter' }, 'fashion')).body;
  await call('POST', '/api/found-via', { name: 'Tiktok' }, 'fashion');

  assert.equal((await call('GET', `/api/entries/${f.id}`)).status, 404, 'a fashion entry is invisible from the UI space');
  assert.equal((await call('GET', `/api/entries/${f.id}`, undefined, 'fashion')).status, 200);
  assert.ok(!(await call('GET', '/api/tags')).body.includes('Boxy'));
  assert.ok(!(await call('GET', '/api/boards')).body.some(b => b.id === board.id));
  assert.ok(!(await call('GET', '/api/found-via')).body.includes('Tiktok'));
  assert.equal((await call('POST', '/api/entries', { url: 'https://iso-fashion.example' })).status, 201, 'the same URL may exist in both spaces');
  assert.equal((await call('POST', '/api/entries', { url: 'https://iso-fashion.example' }, 'fashion')).status, 409);

  await call('POST', '/api/entries/bulk', { ids: [f.id], action: 'delete' }, 'fashion');
  await call('DELETE', `/api/boards/${board.id}`, undefined, 'fashion');
});

test('unknown spaces are refused and no header means the UI space', async () => {
  assert.equal((await call('GET', '/api/entries', undefined, 'nope')).status, 400);
  assert.equal((await call('GET', '/api/entries', undefined, '__proto__')).status, 400);
  const e = await create('https://default-space.example');
  assert.equal((await call('GET', `/api/entries/${e.id}`, undefined, 'ui')).status, 200);
  await call('DELETE', `/api/entries/${e.id}`);
});

test('price and brand exist in the fashion space only', async () => {
  const f = await create('https://pb.example', { price: '  $120 ', brand: 'Acme' }, 'fashion');
  assert.equal(f.price, '$120');
  assert.equal(f.brand, 'Acme');
  const updated = (await call('PUT', `/api/entries/${f.id}`, { price: '$99' }, 'fashion')).body;
  assert.deepEqual([updated.price, updated.brand], ['$99', 'Acme']);
  assert.equal((await call('PUT', `/api/entries/${f.id}`, { price: 5 }, 'fashion')).status, 400);
  assert.equal((await call('PUT', `/api/entries/${f.id}`, { brand: 'x'.repeat(101) }, 'fashion')).status, 400);

  const ui = await create('https://pb-ui.example', { price: '$1', brand: 'Nope' });
  assert.equal(ui.price, undefined);
  assert.equal(ui.brand, undefined);
  assert.equal((await create('https://pb-blank.example', {}, 'fashion')).price, '', 'new fashion entries start with empty price/brand');

  await call('POST', '/api/entries/bulk', { ids: (await call('GET', '/api/entries', undefined, 'fashion')).body.map(e => e.id), action: 'delete' }, 'fashion');
  await call('DELETE', `/api/entries/${ui.id}`);
});

test('each space is saved to its own file, with its own daily backup', async () => {
  const f = await create('https://persist.example', {}, 'fashion');
  await app.flushDB();
  const fashionFile = path.join(tmpDir, 'fashion.json');
  const onDisk = JSON.parse(fs.readFileSync(fashionFile, 'utf8'));
  assert.ok(onDisk.entries.some(e => e.id === f.id));
  assert.ok(!JSON.parse(fs.readFileSync(process.env.OMNIVIEW_DB_PATH, 'utf8')).entries.some(e => e.id === f.id));

  await call('PUT', `/api/entries/${f.id}`, { note: 'again' }, 'fashion'); // second write: file exists, so it is backed up first
  await app.flushDB();
  const backups = fs.readdirSync(path.join(tmpDir, 'backups'));
  assert.ok(backups.some(n => /^fashion-\d{4}-\d{2}-\d{2}\.json$/.test(n)));
  await call('DELETE', `/api/entries/${f.id}`, undefined, 'fashion');
});

test('export and reset only touch their own space', async () => {
  const f = await create('https://exp-fashion.example', {}, 'fashion');
  const u = await create('https://exp-ui.example');
  await upload(f.id, 'image/png', PNG_1PX, 'fashion');

  const json = await (await fetch(`${base}/api/export?format=json&space=fashion`)).json();
  assert.ok(json.entries.some(e => e.id === f.id) && !json.entries.some(e => e.id === u.id));
  const zip = await fetch(`${base}/api/export?format=zip`, { headers: { 'X-Space': 'fashion' } });
  assert.match(zip.headers.get('content-disposition'), /omniview-fashion-export\.zip/);

  const shot = (await call('GET', `/api/entries/${f.id}`, undefined, 'fashion')).body.screenshot;
  assert.equal((await call('POST', '/api/reset', { confirm: 'reset' }, 'fashion')).status, 200);
  assert.deepEqual((await call('GET', '/api/entries', undefined, 'fashion')).body, []);
  assert.ok((await call('GET', '/api/types', undefined, 'fashion')).body.includes('Jacket'), 'reset restores the fashion defaults');
  assert.equal(fs.existsSync(path.join(UPLOADS, shot)), false, 'the wiped space\'s screenshots are removed');
  assert.equal((await call('GET', `/api/entries/${u.id}`)).status, 200, 'the UI space is untouched');
  await call('DELETE', `/api/entries/${u.id}`);
});

// ─── Request guard ───────────────────────────────────────────────────────────
function rawRequest(method, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${urlPath}`, { method, headers }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('mutating requests need the X-Omniview header', async () => {
  assert.equal(await rawRequest('POST', '/api/reset', {}), 403);
  assert.equal((await call('GET', '/api/entries')).status, 200);
});

test('cross-origin and non-local Host requests are refused', async () => {
  assert.equal(await rawRequest('GET', '/api/entries', { Origin: 'https://evil.example' }), 403);
  assert.equal(await rawRequest('GET', '/api/entries', { Host: 'evil.example' }), 403);
});

test('reset requires explicit confirmation', async () => {
  assert.equal((await call('POST', '/api/reset', {})).status, 400);
});

// ─── Screenshots ─────────────────────────────────────────────────────────────
test('uploading then clearing a screenshot deletes the file and its thumbnail', async () => {
  const id = (await create('https://shot.example')).id;

  const up = await upload(id);
  assert.equal(up.status, 200);
  const filePath = path.join(UPLOADS, up.body.screenshot);
  const thumbPath = path.join(UPLOADS, 'thumbs', up.body.screenshot.replace(/\.png$/, '.webp'));
  assert.ok(fs.existsSync(filePath), 'uploaded file should exist on disk');
  assert.ok(fs.existsSync(thumbPath), 'thumbnail should be generated');
  assert.equal((await call('GET', `/api/entries/${id}`)).body.palette.length > 0, true);

  const cleared = await call('PUT', `/api/entries/${id}`, { removeScreenshot: true });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.screenshot, null);
  assert.equal(fs.existsSync(filePath), false, 'cleared file should be removed from disk');
  assert.equal(fs.existsSync(thumbPath), false, 'cleared thumbnail should be removed from disk');

  await call('DELETE', `/api/entries/${id}`);
});

test('an entry can hold several screenshots; the first is the cover', async () => {
  const id = (await create('https://multi.example')).id;
  const a = (await upload(id)).body.screenshot;
  const b = (await upload(id)).body.screenshot;
  let entry = (await call('GET', `/api/entries/${id}`)).body;
  assert.deepEqual(entry.screenshots, [a, b]);
  assert.equal(entry.screenshot, a);

  entry = (await call('DELETE', `/api/entries/${id}/screenshots/${a}`)).body;
  assert.deepEqual(entry.screenshots, [b]);
  assert.equal(entry.screenshot, b);
  assert.equal(fs.existsSync(path.join(UPLOADS, a)), false);
  await call('DELETE', `/api/entries/${id}`);
});

test('screenshot upload rejects disallowed mimetypes (e.g. svg) and undecodable images', async () => {
  const id = (await create('https://svg.example')).id;
  const filesBefore = fs.readdirSync(UPLOADS).length;
  assert.equal((await upload(id, 'image/svg+xml', Buffer.from('<svg onload="alert(1)"></svg>'))).status, 400);
  assert.equal((await upload(id, 'image/png', Buffer.from('not a png'))).status, 400);
  assert.equal(fs.readdirSync(UPLOADS).length, filesBefore, 'rejected uploads must not leave files behind');
  await call('DELETE', `/api/entries/${id}`);
});

test('cleanup removes unreferenced uploads but keeps used ones', async () => {
  const id = (await create('https://cleanup.example')).id;
  const kept = (await upload(id)).body.screenshot;
  const orphan = path.join(UPLOADS, 'orphan.png');
  fs.writeFileSync(orphan, PNG_1PX);

  const preview = await call('GET', '/api/cleanup');
  assert.ok(preview.body.removed >= 1 && preview.body.bytes > 0);
  assert.ok(fs.existsSync(orphan), 'preview must not delete');
  const res = await call('POST', '/api/cleanup');
  assert.equal(res.status, 200);
  assert.ok(res.body.removed >= 1);
  assert.equal(fs.existsSync(orphan), false);
  assert.ok(fs.existsSync(path.join(UPLOADS, kept)));
  await call('DELETE', `/api/entries/${id}`);
});

test('optimize converts a large PNG to a capped WebP and repoints the entry', async () => {
  const sharp = require('sharp');
  const raw = require('node:crypto').randomBytes(3000 * 100 * 3);
  const png = await sharp(raw, { raw: { width: 3000, height: 100, channels: 3 } }).png().toBuffer();
  const id = (await create('https://optimize.example')).id;
  const old = (await upload(id, 'image/png', png)).body.screenshot;
  const res = await call('POST', '/api/optimize');
  assert.equal(res.status, 200);
  assert.ok(res.body.converted >= 1);
  const entry = (await call('GET', `/api/entries/${id}`)).body;
  assert.equal(entry.screenshot, old.replace('.png', '.webp'));
  assert.equal(fs.existsSync(path.join(UPLOADS, old)), false);
  assert.equal((await sharp(path.join(UPLOADS, entry.screenshot)).metadata()).width, 2400);
  await call('DELETE', `/api/entries/${id}`);
});

// ─── Page info ───────────────────────────────────────────────────────────────
test('unfurl reads title, image, favicon and theme color from a page', async () => {
  const site = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><head><title>Fallback</title><meta property="og:title" content="Fish &amp; Chips">' +
      '<meta property="og:image" content="/hero.png"><meta name="theme-color" content="#ABC">' +
      '<link rel="icon" href="/fav.svg"></head></html>');
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  try {
    const res = await call('GET', `/api/unfurl?url=${encodeURIComponent(origin)}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      title: 'Fish & Chips', image: `${origin}/hero.png`, images: [`${origin}/hero.png`], favicon: `${origin}/fav.svg`, themeColor: '#aabbcc',
      brand: null, siteName: null, price: null, currency: null, availability: null, color: null, category: null
    });
    assert.equal((await call('GET', '/api/unfurl?url=javascript:alert(1)')).status, 400);
  } finally {
    site.close();
  }
});

test('unfurl retries a 403 as a browser, decodes entities, and refuses bot-wall pages', async () => {
  const site = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/wall') return res.end('<title>Just a moment...</title>');
    if (!/Chrome/.test(req.headers['user-agent'])) return res.writeHead(403).end('no bots');
    res.end('<title>Men&rsquo;s Jacket&nbsp;&#x27;24 &amp;lt;</title>');
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  try {
    const ok = await call('GET', `/api/unfurl?url=${encodeURIComponent(origin)}`);
    assert.equal(ok.body.title, 'Men’s Jacket \'24 &lt;');
    const wall = await call('GET', `/api/unfurl?url=${encodeURIComponent(origin + '/wall')}`);
    assert.equal(wall.status, 502);
    assert.equal(wall.body.error, 'This site blocked the preview');
  } finally {
    site.close();
  }
});

test('AVIF screenshots are accepted', async () => {
  const sharp = require('sharp');
  const avif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).avif().toBuffer();
  const entry = await create('https://avif.example.com');
  const res = await upload(entry.id, 'image/avif', avif);
  assert.equal(res.status, 200);
  assert.match(res.body.screenshot, /\.avif$/);
  await call('DELETE', `/api/entries/${entry.id}`);
});

test('unfurl reads product details from JSON-LD, even far into a big page', async () => {
  const ld = { '@context': 'https://schema.org', '@graph': [{ '@type': 'ProductGroup', name: 'Vest', brand: { '@type': 'Brand', name: 'Acme' }, color: 'Dark Green', category: 'Vests',
    image: ['https:files/broken.jpg', '/a.jpg', { url: 'https://cdn.example/b.jpg' }],
    hasVariant: [{ '@type': 'Product', offers: [{ price: '59.90', priceCurrency: 'USD' }] }] }] };
  const site = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><head><meta property="og:image" content="/og.jpg"><meta property="og:site_name" content="Acme Co."></head><body>' +
      '<!--' + 'x'.repeat(1.5 * 1024 * 1024) + '-->' +
      `<script type="application/ld+json">${JSON.stringify(ld)}</script></body></html>`);
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  try {
    const { body } = await call('GET', `/api/unfurl?url=${encodeURIComponent(origin)}`);
    assert.deepEqual({ brand: body.brand, siteName: body.siteName, price: body.price, currency: body.currency, color: body.color, category: body.category },
      { brand: 'Acme', siteName: 'Acme Co.', price: '59.9', currency: 'USD', color: 'Dark Green', category: 'Vests' });
    assert.deepEqual(body.images, [`${origin}/og.jpg`, `${origin}/a.jpg`, 'https://cdn.example/b.jpg']);
  } finally {
    site.close();
  }
});

test('unfurl falls back to microdata, data-price, product:* tags and symbol currencies', async () => {
  const pages = {
    '/micro': '<span itemprop="price" content="45.00">$45</span><meta itemprop="priceCurrency" content="GBP">',
    '/data': '<div data-price="30.50"></div>',
    '/og': '<meta property="product:brand" content="Acme"><meta property="product:category" content="Boots"><meta property="product:availability" content="out of stock"><meta property="product:price:amount" content="80">',
    '/symbol': `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', offers: { price: '$1,299.00', priceCurrency: '€', availability: 'https://schema.org/InStock' } })}</script>`
  };
  const site = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<html><body>${pages[req.url]}</body></html>`); });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const get = async p => (await call('GET', `/api/unfurl?url=${encodeURIComponent(origin + p)}`)).body;
  try {
    const micro = await get('/micro');
    assert.deepEqual([micro.price, micro.currency], ['45', 'GBP']);
    assert.equal((await get('/data')).price, '30.5');
    const og = await get('/og');
    assert.deepEqual([og.brand, og.category, og.availability, og.price], ['Acme', 'Boots', 'out of stock', '80']);
    const symbol = await get('/symbol');
    assert.deepEqual([symbol.price, symbol.currency, symbol.availability], ['1299', 'EUR', 'InStock']);
  } finally {
    site.close();
  }
});

test('Shopify variant and collection URLs count as the same page', async () => {
  const first = await create('https://shop.example/collections/men/products/boot?variant=1&utm_source=x');
  const dupe = await call('POST', '/api/entries', { title: 'Boot', url: 'https://www.shop.example/products/boot?variant=2' });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.body.duplicate.id, first.id);
  await call('POST', '/api/entries/bulk', { ids: [first.id], action: 'delete' });
});

// ─── Bulk ────────────────────────────────────────────────────────────────────
test('bulk tag and bulk delete', async () => {
  const a = await create('https://a.example');
  const b = await create('https://b.example');
  await call('POST', '/api/tags', { name: 'BulkTestTag' });

  const tagRes = await call('POST', '/api/entries/bulk', { ids: [a.id, b.id], action: 'tag', tag: 'BulkTestTag' });
  assert.equal(tagRes.status, 200);
  const afterTag = await call('GET', `/api/entries/${a.id}`);
  assert.ok(afterTag.body.style_tags.includes('BulkTestTag'));

  const delRes = await call('POST', '/api/entries/bulk', { ids: [a.id, b.id], action: 'delete' });
  assert.equal(delRes.status, 200);
  assert.equal((await call('GET', `/api/entries/${a.id}`)).status, 404);
});

test('bulk untag, set type, favorite, and board add/remove', async () => {
  const board = (await call('POST', '/api/boards', { name: 'BulkBoard' })).body;
  const e = await create('https://bulk2.example', { style_tags: ['Minimal'] });
  const bulk = body => call('POST', '/api/entries/bulk', { ids: [e.id], ...body });
  const get = async () => (await call('GET', `/api/entries/${e.id}`)).body;

  await bulk({ action: 'untag', tag: 'Minimal' });
  assert.deepEqual((await get()).style_tags, []);
  await bulk({ action: 'setType', type: 'Web App' });
  assert.equal((await get()).type, 'Web App');
  await bulk({ action: 'favorite', value: true });
  assert.equal((await get()).favorite, true);
  await bulk({ action: 'addToBoard', boards: board.id });
  assert.deepEqual((await get()).boards, [board.id]);
  await bulk({ action: 'removeFromBoard', boards: board.id });
  assert.deepEqual((await get()).boards, []);
  assert.equal((await bulk({ action: 'nope' })).status, 400);

  await call('DELETE', `/api/entries/${e.id}`);
  await call('DELETE', `/api/boards/${board.id}`);
});

// ─── Tags / boards ───────────────────────────────────────────────────────────
test('whitespace-only option name is rejected', async () => {
  const res = await call('POST', '/api/tags', { name: '   ' });
  assert.equal(res.status, 400);
});

test('renaming a tag to a name that already exists is rejected', async () => {
  await call('POST', '/api/tags', { name: 'RenameSrc' });
  await call('POST', '/api/tags', { name: 'RenameDst' });
  const res = await call('PUT', '/api/tags/RenameSrc', { newName: 'RenameDst' });
  assert.equal(res.status, 409);
});

test('renaming a tag to itself does not collide with itself', async () => {
  await call('POST', '/api/tags', { name: 'CaseTag' });
  const res = await call('PUT', '/api/tags/CaseTag', { newName: 'CaseTag' });
  assert.equal(res.status, 200);
});

test('tag names with special characters round-trip through the URL', async () => {
  await call('POST', '/api/tags', { name: '100% Fun/Games' });
  const res = await call('PUT', `/api/tags/${encodeURIComponent('100% Fun/Games')}`, { newName: '100% Fun' });
  assert.equal(res.status, 200);
  assert.ok(res.body.tags.includes('100% Fun'));
  await call('DELETE', `/api/tags/${encodeURIComponent('100% Fun')}`);
});

test('deleting a tag removes it from entries', async () => {
  const e = await create('https://tagdel.example', { style_tags: ['DoomedTag', 'Minimal'] });
  await call('DELETE', '/api/tags/DoomedTag');
  const after = (await call('GET', `/api/entries/${e.id}`)).body;
  assert.deepEqual(after.style_tags, ['Minimal']);
  await call('DELETE', `/api/entries/${e.id}`);
});

test('merging tags rewrites entries and drops the sources', async () => {
  const e = await create('https://merge.example', { style_tags: ['MergeA', 'MergeB'] });
  const f = await create('https://merge2.example', { style_tags: ['MergeB'] });
  const res = await call('POST', '/api/tags/merge', { sources: ['MergeA', 'MergeB'], target: 'MergedTag' });
  assert.equal(res.status, 200);
  assert.ok(!res.body.tags.includes('MergeA') && !res.body.tags.includes('MergeB'));
  assert.ok(res.body.tags.includes('MergedTag'));
  assert.deepEqual((await call('GET', `/api/entries/${e.id}`)).body.style_tags, ['MergedTag']);
  assert.deepEqual((await call('GET', `/api/entries/${f.id}`)).body.style_tags, ['MergedTag']);
  await call('POST', '/api/entries/bulk', { ids: [e.id, f.id], action: 'delete' });
});

test('bulk-deleting tags removes them everywhere', async () => {
  const e = await create('https://bd.example', { style_tags: ['BdOne', 'BdTwo'] });
  await call('POST', '/api/tags/bulk-delete', { names: ['BdOne', 'BdTwo'] });
  assert.deepEqual((await call('GET', `/api/entries/${e.id}`)).body.style_tags, []);
  await call('DELETE', `/api/entries/${e.id}`);
});

test('board name is trimmed on create and rename', async () => {
  const created = await call('POST', '/api/boards', { name: '  My Board  ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'My Board');

  const rename = await call('PUT', `/api/boards/${created.body.id}`, { name: '  Renamed  ' });
  assert.equal(rename.body.name, 'Renamed');
});

test('deleting a board removes it from entries and counts are right', async () => {
  const board = (await call('POST', '/api/boards', { name: 'Cascade' })).body;
  const e = await create('https://cascade.example', { boards: [board.id, 'ghost-board'] });
  assert.deepEqual(e.boards, [board.id], 'unknown board ids are dropped');
  assert.equal((await call('GET', '/api/boards')).body.find(b => b.id === board.id).count, 1);

  await call('DELETE', `/api/boards/${board.id}`);
  assert.deepEqual((await call('GET', `/api/entries/${e.id}`)).body.boards, []);
  await call('DELETE', `/api/entries/${e.id}`);
});

// ─── Round-2 edge cases ──────────────────────────────────────────────────────
test('blank board name on rename is a 400', async () => {
  const board = (await call('POST', '/api/boards', { name: 'KeepMe' })).body;
  assert.equal((await call('PUT', `/api/boards/${board.id}`, { name: '   ' })).status, 400);
  assert.equal((await call('GET', '/api/boards')).body.find(b => b.id === board.id).name, 'KeepMe');
  await call('DELETE', `/api/boards/${board.id}`);
});

test('deleting an unknown tag, type or found-via is a 404', async () => {
  for (const p of ['tags', 'types', 'found-via']) assert.equal((await call('DELETE', `/api/${p}/NoSuchThing`)).status, 404, p);
});

test('merging into a blank target registers nothing', async () => {
  await call('POST', '/api/tags', { name: 'MergeBlankSrc' });
  assert.equal((await call('POST', '/api/tags/merge', { sources: ['MergeBlankSrc'], target: '  ' })).status, 400);
  const tags = (await call('GET', '/api/tags')).body;
  assert.ok(!tags.includes(''));
  assert.ok(tags.includes('MergeBlankSrc'));
  await call('DELETE', '/api/tags/MergeBlankSrc');
});

test('bulk reports how many entries changed; no match means no side effects', async () => {
  const e = await create('https://bulkcount.example');
  const mixed = (await call('POST', '/api/entries/bulk', { ids: [e.id, 'ghost'], action: 'favorite', value: true })).body;
  assert.equal(mixed.updated, 1);
  assert.deepEqual(mixed.results, [{ id: e.id, updated: true }, { id: 'ghost', updated: false }]);
  const none = await call('POST', '/api/entries/bulk', { ids: ['ghost'], action: 'tag', tag: 'NeverRegistered' });
  assert.equal(none.body.updated, 0);
  assert.ok(!(await call('GET', '/api/tags')).body.includes('NeverRegistered'));
  assert.equal((await call('POST', '/api/entries/bulk', { ids: ['ghost'], action: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/entries/bulk', { ids: [e.id], action: 'favorite', value: 'yes' })).status, 400);
  assert.equal((await call('POST', '/api/entries/bulk', { ids: [e.id], action: 'favorite' })).status, 400);
  await call('DELETE', `/api/entries/${e.id}`);
});

test('export refuses unknown formats and stamps a version', async () => {
  assert.equal((await fetch(`${base}/api/export?format=xml`)).status, 400);
  const json = await (await fetch(`${base}/api/export?format=json`)).json();
  assert.equal(json.version, 1);
  assert.equal(json.space, 'ui');
  assert.equal(json.trash, undefined);
});

// ─── Export / reset (last: reset wipes everything) ───────────────────────────
test('export returns the library as JSON and as a ZIP', async () => {
  const e = await create('https://export.example');
  await upload(e.id);

  const json = await fetch(`${base}/api/export?format=json`);
  assert.equal(json.status, 200);
  assert.ok((await json.json()).entries.some(x => x.id === e.id));

  const zip = await fetch(`${base}/api/export?format=zip`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), 'PK');
});

test('reset wipes entries and screenshot files', async () => {
  const e = await create('https://reset.example');
  const shot = (await upload(e.id)).body.screenshot;

  const res = await call('POST', '/api/reset', { confirm: 'reset' });
  assert.equal(res.status, 200);
  assert.deepEqual((await call('GET', '/api/entries')).body, []);
  assert.equal(fs.existsSync(path.join(UPLOADS, shot)), false);
});

test('board description, emoji, color, pin and ordering', async () => {
  const a = (await call('POST', '/api/boards', { name: 'OrdA' })).body;
  const b = (await call('POST', '/api/boards', { name: 'OrdB' })).body;
  const upd = await call('PUT', `/api/boards/${a.id}`, { description: ' Due Nov 3 ', emoji: '🎨', color: '#e5484d', pinned: true });
  assert.equal(upd.body.description, 'Due Nov 3');
  assert.equal(upd.body.pinned, true);
  assert.equal((await call('PUT', `/api/boards/${a.id}`, { name: '  ' })).status, 400);
  assert.equal((await call('PUT', `/api/boards/${a.id}`, { color: 'red' })).status, 400);

  await call('PUT', '/api/boards/order', { ids: [b.id, a.id] });
  const ids = (await call('GET', '/api/boards')).body.map(x => x.id);
  assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));

  const e1 = await create('https://ord1.example');
  const e2 = await create('https://ord2.example');
  const order = await call('PUT', `/api/boards/${a.id}/order`, { ids: [e2.id, 'ghost', e1.id] });
  assert.deepEqual(order.body.order, [e2.id, e1.id]);

  for (const id of [a.id, b.id]) await call('DELETE', `/api/boards/${id}`);
  for (const e of [e1, e2]) await call('DELETE', `/api/entries/${e.id}`);
});

test('editing an entry sets updated_at; favoriting does not', async () => {
  const e = await create('https://upd.example');
  assert.equal(e.updated_at, undefined);
  assert.equal((await call('PUT', `/api/entries/${e.id}`, { favorite: true })).body.updated_at, undefined);
  assert.ok((await call('PUT', `/api/entries/${e.id}`, { note: 'x' })).body.updated_at);
  await call('DELETE', `/api/entries/${e.id}`);
});

// ─── Trash ───────────────────────────────────────────────────────────────────
test('deleting moves an entry to the trash; restore and purge work', async () => {
  const e = await create('https://trash.example', { title: 'Trashy', style_tags: ['TrashTag'] });
  const shot = (await upload(e.id)).body.screenshot;

  await call('DELETE', `/api/entries/${e.id}`);
  assert.equal((await call('GET', `/api/entries/${e.id}`)).status, 404);
  assert.ok(fs.existsSync(path.join(UPLOADS, shot)), 'files stay while the entry is in the trash');
  let trash = (await call('GET', '/api/trash')).body;
  assert.equal(trash.find(t => t.id === e.id).days_left, 30);

  await call('DELETE', '/api/tags/TrashTag');
  const restored = await call('POST', `/api/trash/${e.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.deleted_at, undefined);
  assert.ok((await call('GET', '/api/tags')).body.includes('TrashTag'), 'tags it used are registered again');
  assert.equal((await call('POST', `/api/trash/${e.id}/restore`)).status, 404);

  // Past 30 days it is purged, files included.
  await call('DELETE', `/api/entries/${e.id}`);
  const realNow = Date.now;
  Date.now = () => realNow() + 31 * 864e5;
  try { trash = (await call('GET', '/api/trash')).body; } finally { Date.now = realNow; }
  assert.equal(trash.some(t => t.id === e.id), false);
  assert.equal(fs.existsSync(path.join(UPLOADS, shot)), false);
});

test('trash: delete forever and empty; bulk delete lands there too', async () => {
  const a = await create('https://trash-a.example');
  const b = await create('https://trash-b.example');
  await call('POST', '/api/entries/bulk', { ids: [a.id, b.id], action: 'delete' });
  assert.equal((await call('GET', '/api/trash')).body.filter(t => [a.id, b.id].includes(t.id)).length, 2);
  assert.equal((await call('DELETE', `/api/trash/${a.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/trash/${a.id}`)).status, 404);
  assert.equal((await call('GET', '/api/export')).body.trash, undefined, 'export leaves the trash out');
  await call('DELETE', '/api/trash');
  assert.equal((await call('GET', '/api/trash')).body.length, 0);
});

// ─── Save failures ───────────────────────────────────────────────────────────
test('a failed write is reported on every answer until a write succeeds', async () => {
  const blocker = `${process.env.OMNIVIEW_DB_PATH}.tmp`;
  fs.mkdirSync(blocker); // writeFile onto a directory fails with EISDIR
  try {
    await create('https://save-fail.example');
    await app.flushDB();
    const res = await fetch(`${base}/api/health`);
    assert.match(res.headers.get('x-save-error'), /library\.json: EISDIR/);
    assert.match((await res.json()).saveError, /EISDIR/);
  } finally {
    fs.rmdirSync(blocker);
  }
  await app.flushDB(); // dirty from the failed attempt, now succeeds
  const ok = await fetch(`${base}/api/health`);
  assert.equal(ok.headers.get('x-save-error'), null);
  assert.equal((await ok.json()).saveError, null);
});

// ─── Single-server lock ──────────────────────────────────────────────────────
test('the lock refuses a live owner and replaces a stale one', () => {
  const lock = path.join(tmpDir, 'test.lock');
  app.acquireLock(lock);
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  app.acquireLock(lock); // our own PID is a leftover from this process, not a rival
  fs.writeFileSync(lock, String(process.ppid)); // the test runner's parent is alive
  assert.throws(() => app.acquireLock(lock), /already using/);
  fs.writeFileSync(lock, '99999999'); // no such process
  app.acquireLock(lock);
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  fs.rmSync(lock);
});

// ─── Library validation ──────────────────────────────────────────────────────
test('libraryProblems names missing ids, duplicates and dangling boards', () => {
  const problems = app.libraryProblems({
    entries: [{ id: 'a', title: 'A', boards: ['b1', 'gone'] }, { id: 'a', title: 'A2', boards: [] }, { title: 'No id', boards: [] }],
    trash: [],
    boards: [{ id: 'b1', name: 'One' }]
  });
  assert.deepEqual(problems.map(p => p.replace(/\s*\(.*?\)/, '')), [
    'duplicate entry id a',
    'entry #3 has no id',
    'entry a is on missing board gone'
  ]);
});

// ─── Storage + duplicate images ──────────────────────────────────────────────
test('storage reports counts and sizes', async () => {
  await upload((await create('https://storage.example')).id);
  const s = (await call('GET', '/api/storage')).body;
  assert.equal(s.dataDir, tmpDir);
  assert.ok(s.spaces.ui.entries >= 0 && s.spaces.fashion.entries >= 0);
  assert.ok(s.uploads.files > 0 && s.uploads.bytes > 0);
  assert.ok(s.thumbs.files > 0);
});

test('uploading an identical image reports which entry already has it', async () => {
  const png = await require('sharp')({ create: { width: 3, height: 3, channels: 3, background: { r: 12, g: 99, b: 200 } } }).png().toBuffer();
  const a = await create('https://dup-img-a.example', { title: 'First' });
  const b = await create('https://dup-img-b.example');
  assert.equal((await upload(a.id, 'image/png', png)).body.duplicateOf, null);
  const again = await upload(b.id, 'image/png', png);
  assert.equal(again.status, 200);
  assert.equal(again.body.screenshots.length, 1, 'the duplicate is still attached');
  assert.deepEqual(again.body.duplicateOf, { id: a.id, title: 'First', space: 'ui', trashed: false });
});

// ─── Request caps, log redaction, EXIF ───────────────────────────────────────
test('bulk caps the id count; other routes cap the body at 100 kb', async () => {
  const many = Array.from({ length: 5001 }, (_, i) => `id-${i}`);
  const res = await call('POST', '/api/entries/bulk', { ids: many, action: 'delete' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /At most 5000/);
  assert.equal((await call('POST', '/api/entries/bulk', { ids: many.slice(0, 5000), action: 'favorite' })).status, 200);
  assert.equal((await call('POST', '/api/entries', { url: 'https://big.example', note: 'x'.repeat(150 * 1024) })).status, 413);
});

test('the request log leaves the query off fetch routes', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await call('GET', '/api/unfurl?url=ftp://shop.example/?token=SECRET123'); // 400, so it is logged
    await new Promise(r => setTimeout(r, 20));
  } finally { console.log = orig; }
  const line = lines.find(l => l.includes('/api/unfurl'));
  assert.ok(line, 'request was logged');
  assert.ok(!line.includes('SECRET123') && !line.includes('?'));
});

test('uploads lose EXIF (GPS) but keep their orientation', async () => {
  const sharp = require('sharp');
  const jpg = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#369' } })
    .withExif({ IFD0: { Copyright: 'me' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } }).jpeg().toBuffer();
  assert.ok((await sharp(jpg).metadata()).exif, 'fixture has EXIF');
  const entry = await create('https://exif.example');
  const { status, body } = await upload(entry.id, 'image/jpeg', jpg);
  assert.equal(status, 200);
  const stored = await sharp(path.join(UPLOADS, body.screenshot)).metadata();
  assert.equal(stored.exif, undefined);
  assert.equal(stored.width, 40);
});
