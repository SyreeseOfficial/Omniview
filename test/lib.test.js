'use strict';

// Client-side pure helpers (public/js/lib.js), imported as ESM from this CommonJS test.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const entry = (id, over = {}) => ({ id, style_tags: [], palette: [], type: '', color: '', ...over });

test('moreLike ranks by palette, shared tags and type', async () => {
  const { moreLike, paletteSimilarity } = await import('../public/js/lib.js');
  const me = entry('me', { palette: ['#000000', '#111111'], style_tags: ['Dark'], type: 'Website' });
  const dark = entry('dark', { palette: ['#050505', '#101010'] });
  const light = entry('light', { palette: ['#ffffff', '#eeeeee'] });
  const tagged = entry('tagged', { palette: ['#ffffff'], style_tags: ['Dark'], type: 'Website' });

  assert.ok(paletteSimilarity(me.palette, dark.palette) > paletteSimilarity(me.palette, light.palette));
  assert.deepEqual(moreLike(me, [light, dark, tagged, me], true).map(e => e.id), ['dark', 'tagged', 'light']);
  // Fashion ignores the palette: with no tags/type/color in common nothing is "like" it.
  assert.deepEqual(moreLike(me, [light, dark], false), []);
});

test('inAddedRange: week starts Monday, month starts the 1st, custom is inclusive', async () => {
  const { inAddedRange } = await import('../public/js/lib.js');
  const now = new Date(2026, 9, 18, 12); // Sunday 18 Oct 2026
  const at = (m, d, h = 12) => new Date(2026, m, d, h).toISOString();

  assert.ok(inAddedRange(at(9, 12, 0), { added: 'week' }, now));   // Monday morning
  assert.ok(!inAddedRange(at(9, 11), { added: 'week' }, now));     // Sunday before
  assert.ok(inAddedRange(at(9, 1, 0), { added: 'month' }, now));
  assert.ok(!inAddedRange(at(8, 30), { added: 'month' }, now));
  assert.ok(inAddedRange(at(9, 5, 23), { added: 'custom', from: '2026-10-05', to: '2026-10-05' }, now));
  assert.ok(!inAddedRange(at(9, 6, 1), { added: 'custom', from: '2026-10-05', to: '2026-10-05' }, now));
  assert.ok(inAddedRange(at(0, 1), { added: 'custom', from: '', to: '2026-10-05' }, now));
});

test('timeAgo picks the largest whole unit', async () => {
  const { timeAgo } = await import('../public/js/lib.js');
  const now = new Date('2026-10-18T12:00:00Z');
  const ago = ms => new Date(now - ms).toISOString();
  assert.equal(timeAgo(ago(20e3), now), 'just now');
  assert.equal(timeAgo(ago(60e3), now), '1 minute ago');
  assert.equal(timeAgo(ago(3 * 86400e3), now), '3 days ago');
  assert.equal(timeAgo(ago(14 * 86400e3), now), '2 weeks ago');
  assert.equal(timeAgo(ago(400 * 86400e3), now), '1 year ago');
});

test('contrastRatio matches the WCAG reference values', async () => {
  const { contrastRatio, contrastLevel } = await import('../public/js/lib.js');
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.equal(contrastRatio('#767676', '#ffffff').toFixed(2), '4.54'); // the classic AA gray
  assert.equal(contrastLevel(21), 'AAA');
  assert.equal(contrastLevel(4.54), 'AA');
  assert.equal(contrastLevel(3.2), 'AA Large');
  assert.equal(contrastLevel(2), null);
});

test('orderEntries puts the manual order first and keeps the rest in place', async () => {
  const { orderEntries } = await import('../public/js/lib.js');
  const list = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  assert.deepEqual(orderEntries(list, ['c', 'ghost', 'a']).map(e => e.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(orderEntries(list, []).map(e => e.id), ['a', 'b', 'c', 'd']);
});
