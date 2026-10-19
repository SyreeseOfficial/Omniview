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
