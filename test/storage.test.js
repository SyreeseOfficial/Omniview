'use strict';

// Startup behaviour: a corrupt library falls back to the newest backup, bad dates are
// repaired, missing screenshot files are counted, and old trash is purged on the daily write.
// Needs its own data directory, written before the server module is loaded.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniview-storage-'));
process.env.OMNIVIEW_DB_PATH = path.join(tmpDir, 'library.json');
process.env.OMNIVIEW_UPLOADS_DIR = path.join(tmpDir, 'uploads');
fs.mkdirSync(path.join(tmpDir, 'backups'));

const entry = (id, extra = {}) => ({ id, url: `https://${id}.example`, title: id, screenshots: [], boards: [], style_tags: [], date_added: '2026-10-01T00:00:00.000Z', ...extra });
const day = n => new Date(Date.now() - n * 864e5).toISOString();

fs.writeFileSync(process.env.OMNIVIEW_DB_PATH, '{ "entries": [ not json');
fs.writeFileSync(path.join(tmpDir, 'backups', 'library-2026-10-16.json'), JSON.stringify({ entries: [entry('older')], boards: [], tags: [], types: [], foundVia: [] }));
fs.writeFileSync(path.join(tmpDir, 'backups', 'library-2026-10-17.json'), JSON.stringify({
  entries: [entry('good'), entry('bad-date', { date_added: 'last tuesday', updated_at: '2026-09-09T00:00:00.000Z' }), entry('no-file', { screenshots: ['gone.png'] })],
  boards: [], tags: [], types: [], foundVia: []
}));
fs.writeFileSync(path.join(tmpDir, 'backups', 'library-2026-10-18.json'), '{ also broken'); // the newest one is skipped if it does not parse
fs.writeFileSync(path.join(tmpDir, 'fashion.json'), JSON.stringify({
  entries: [], boards: [], tags: [], types: [], foundVia: [],
  trash: [entry('old-trash', { deleted_at: day(40) }), entry('new-trash', { deleted_at: day(2) })]
}));

const app = require('../server.js');
let server, base;
before(() => new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
after(async () => {
  await app.flushDB();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const get = async (p, space) => (await fetch(`${base}${p}`, { headers: space ? { 'X-Space': space } : {} })).json();

test('a corrupt library starts from the newest readable backup and says so', async () => {
  const ui = (await get('/api/spaces')).find(s => s.name === 'ui');
  assert.match(ui.notice, /^Restored from backup 2026-10-17: library\.json was unreadable/);
  assert.deepEqual((await get('/api/entries')).map(e => e.id), ['good', 'bad-date', 'no-file']);
  assert.ok(fs.readdirSync(tmpDir).some(f => f.startsWith('library.json.corrupt-')), 'the damaged file is kept');
  await app.flushDB();
  assert.equal(JSON.parse(fs.readFileSync(process.env.OMNIVIEW_DB_PATH, 'utf8')).entries.length, 3, 'the restored library is written back');
  assert.equal((await get('/api/spaces')).find(s => s.name === 'fashion').notice, null);
});

test('an invalid date_added is repaired from updated_at', async () => {
  const bad = (await get('/api/entries')).find(e => e.id === 'bad-date');
  assert.equal(bad.date_added, '2026-09-09T00:00:00.000Z');
});

test('Storage counts entries whose screenshot file is missing', async () => {
  assert.equal((await get('/api/storage')).spaces.ui.brokenImages, 1);
});

test('the first write of a day purges trash older than 30 days', async () => {
  assert.equal((await get('/api/storage')).spaces.fashion.trash, 2); // /api/trash would purge by itself
  await fetch(`${base}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Omniview': '1', 'X-Space': 'fashion' }, body: JSON.stringify({ url: 'https://trigger.example' }) });
  await app.flushDB();
  await app.flushDB(); // the purge schedules its own write
  assert.equal((await get('/api/storage')).spaces.fashion.trash, 1);
});
