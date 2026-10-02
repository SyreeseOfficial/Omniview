'use strict';

// Smoke tests over the real HTTP API, backed by a throwaway db/uploads dir
// so they never touch the real library. Run with `npm test` (node --test).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniview-test-'));
process.env.OMNIVIEW_DB_PATH = path.join(tmpDir, 'library.json');
process.env.OMNIVIEW_UPLOADS_DIR = path.join(tmpDir, 'uploads');

const app = require('../server.js');

let server, base;

before(() => new Promise(resolve => {
  server = app.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => {
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resolve();
  });
}));

async function call(method, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

test('create, update, and delete an entry', async () => {
  const create = await call('POST', '/api/entries', { url: 'https://example.com' });
  assert.equal(create.status, 201);
  const id = create.body.entry.id;

  const update = await call('PUT', `/api/entries/${id}`, { title: 'Example' });
  assert.equal(update.status, 200);
  assert.equal(update.body.title, 'Example');

  const del = await call('DELETE', `/api/entries/${id}`);
  assert.equal(del.status, 200);

  const list = await call('GET', '/api/entries');
  assert.equal(list.body.find(e => e.id === id), undefined);
});

test('search matches entry title', async () => {
  const create = await call('POST', '/api/entries', { url: 'https://foo.example', title: 'Findable Title' });
  const id = create.body.entry.id;
  const list = await call('GET', '/api/entries?q=findable');
  assert.ok(list.body.some(e => e.id === id));
  await call('DELETE', `/api/entries/${id}`);
});

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('uploading then clearing a screenshot deletes the file', async () => {
  const create = await call('POST', '/api/entries', { url: 'https://shot.example' });
  const id = create.body.entry.id;

  const form = new FormData();
  form.append('screenshot', new Blob([PNG_1PX], { type: 'image/png' }), 'shot.png');
  const uploadRes = await fetch(`${base}/api/entries/${id}/screenshot`, { method: 'POST', body: form });
  const uploadBody = await uploadRes.json();
  assert.equal(uploadRes.status, 200);
  const filePath = path.join(process.env.OMNIVIEW_UPLOADS_DIR, uploadBody.screenshot);
  assert.ok(fs.existsSync(filePath), 'uploaded file should exist on disk');

  const cleared = await call('PUT', `/api/entries/${id}`, { removeScreenshot: true });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.screenshot, null);
  assert.equal(fs.existsSync(filePath), false, 'cleared file should be removed from disk');

  await call('DELETE', `/api/entries/${id}`);
});

test('screenshot upload rejects disallowed mimetypes (e.g. svg)', async () => {
  const create = await call('POST', '/api/entries', { url: 'https://svg.example' });
  const id = create.body.entry.id;

  const form = new FormData();
  form.append('screenshot', new Blob([Buffer.from('<svg onload="alert(1)"></svg>')], { type: 'image/svg+xml' }), 'evil.svg');
  const res = await fetch(`${base}/api/entries/${id}/screenshot`, { method: 'POST', body: form });
  assert.equal(res.status, 400);

  await call('DELETE', `/api/entries/${id}`);
});

test('bulk tag and bulk delete', async () => {
  const a = (await call('POST', '/api/entries', { url: 'https://a.example' })).body.entry;
  const b = (await call('POST', '/api/entries', { url: 'https://b.example' })).body.entry;
  await call('POST', '/api/tags', { name: 'BulkTestTag' });

  const tagRes = await call('POST', '/api/entries/bulk', { ids: [a.id, b.id], action: 'tag', tag: 'BulkTestTag' });
  assert.equal(tagRes.status, 200);
  const afterTag = await call('GET', `/api/entries/${a.id}`);
  assert.ok(afterTag.body.style_tags.includes('BulkTestTag'));

  const delRes = await call('POST', '/api/entries/bulk', { ids: [a.id, b.id], action: 'delete' });
  assert.equal(delRes.status, 200);
  assert.equal((await call('GET', `/api/entries/${a.id}`)).status, 404);
});

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

test('board name is trimmed on create and rename', async () => {
  const create = await call('POST', '/api/boards', { name: '  My Board  ' });
  assert.equal(create.status, 201);
  assert.equal(create.body.name, 'My Board');

  const rename = await call('PUT', `/api/boards/${create.body.id}`, { name: '  Renamed  ' });
  assert.equal(rename.body.name, 'Renamed');
});

test('unknown entry id returns 404', async () => {
  const res = await call('GET', '/api/entries/does-not-exist');
  assert.equal(res.status, 404);
});
