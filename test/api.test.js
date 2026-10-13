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

async function call(method, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...GUARD } : GUARD,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

const create = async (url, extra = {}) => (await call('POST', '/api/entries', { url, ...extra })).body.entry;

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function upload(id, type = 'image/png', data = PNG_1PX) {
  const form = new FormData();
  form.append('screenshot', new Blob([data], { type }), 'shot');
  const res = await fetch(`${base}/api/entries/${id}/screenshot`, { method: 'POST', headers: GUARD, body: form });
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

  const res = await call('POST', '/api/cleanup');
  assert.equal(res.status, 200);
  assert.ok(res.body.removed >= 1);
  assert.equal(fs.existsSync(orphan), false);
  assert.ok(fs.existsSync(path.join(UPLOADS, kept)));
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
    assert.deepEqual(res.body, { title: 'Fish & Chips', image: `${origin}/hero.png`, favicon: `${origin}/fav.svg`, themeColor: '#aabbcc' });
    assert.equal((await call('GET', '/api/unfurl?url=javascript:alert(1)')).status, 400);
  } finally {
    site.close();
  }
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
