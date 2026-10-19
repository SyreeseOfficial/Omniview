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

test('orderEntries puts the manual order first and keeps the rest in place', async () => {
  const { orderEntries } = await import('../public/js/lib.js');
  const list = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  assert.deepEqual(orderEntries(list, ['c', 'ghost', 'a']).map(e => e.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(orderEntries(list, []).map(e => e.id), ['a', 'b', 'c', 'd']);
});

test('suggestTags reads lightness and saturation from the palette', async () => {
  const { suggestTags } = await import('../public/js/lib.js');
  assert.deepEqual(suggestTags([]), []);
  assert.deepEqual(suggestTags(['#0b0b0f', '#2a2a30']), ['Dark Mode', 'Monochrome']);
  assert.deepEqual(suggestTags(['#fafafa', '#e0e0e0']), ['Light Mode', 'Monochrome']);
  assert.deepEqual(suggestTags(['#808080', '#e5484d', '#3e63dd', '#30a46c']), ['Colorful']);
  assert.deepEqual(suggestTags(['#e5484d', '#d03a40', '#c02f35']), [], 'one hue is not colorful');
});

test('dominantColors buckets RGBA pixels', async () => {
  const { dominantColors } = await import('../public/js/lib.js');
  const px = (r, g, b, n) => Array.from({ length: n }, () => [r, g, b, 255]).flat();
  const colors = dominantColors(Uint8ClampedArray.from([...px(255, 0, 0, 30), ...px(250, 5, 5, 5), ...px(0, 0, 255, 10), 0, 0, 0, 0]));
  assert.ok(colors[0].startsWith('#f'), 'red first');
  assert.equal(colors.length, 2);
  assert.ok(colors[1].startsWith('#0000'));
});

test('tag aliases and near-duplicate detection', async () => {
  const { tagMatches, similarTag } = await import('../public/js/lib.js');
  assert.ok(tagMatches('Monochrome', 'bw'));
  assert.ok(tagMatches('Dark Mode', 'nig'));
  assert.ok(!tagMatches('Dark Mode', 'xyz'));
  assert.ok(tagMatches('Flat', ''));
  const tags = ['Minimal', 'Gradient', 'Retro', 'Brutalist'];
  assert.equal(similarTag('Minimalist', tags), 'Minimal');
  assert.equal(similarTag('Gradients', tags), 'Gradient');
  assert.equal(similarTag('Retroo', tags), 'Retro');
  assert.equal(similarTag('Brutalizt', tags), 'Brutalist');
  assert.equal(similarTag('Playful', tags), null);
  assert.equal(similarTag('Min', tags), null, 'short prefixes are not near-duplicates');
});

test('libraryStats counts months, top tags/sources and favorites\' palette', async () => {
  const { libraryStats } = await import('../public/js/lib.js');
  const now = new Date(2026, 9, 18); // October
  const e = (date, over = {}) => ({ date_added: new Date(date).toISOString(), style_tags: [], palette: [], favorite: false, found_via: '', type: null, ...over });
  const s = libraryStats([
    e(new Date(2026, 9, 2), { style_tags: ['Minimal', 'Bold'], found_via: 'Dribbble', favorite: true, palette: ['#ff0000', '#00ff00'] }),
    e(new Date(2026, 9, 9), { style_tags: ['Minimal'], found_via: 'Dribbble', favorite: true, palette: ['#fe0101'] }),
    e(new Date(2025, 10, 3), { type: 'Website' }),
    e(new Date(2020, 0, 1), { style_tags: ['Old'] }) // outside the window: counted in total and tags, not in months
  ], now);
  assert.equal(s.total, 4);
  assert.equal(s.perMonth.length, 12);
  assert.deepEqual([s.perMonth[0].key, s.perMonth[0].n], ['2025-11', 1]);
  assert.deepEqual([s.perMonth[11].key, s.perMonth[11].n, s.perMonth[11].label], ['2026-10', 2, 'Oct']);
  assert.deepEqual(s.tags[0], ['Minimal', 2]);
  assert.deepEqual(s.via, [['Dribbble', 2]]);
  assert.equal(s.palette.length, 2, 'near-identical reds collapse into one');
});

test('priceOf prefers the number next to a currency, else the first', async () => {
  const { priceOf } = await import('../public/js/lib.js');
  const p = price => priceOf({ price });
  assert.equal(p('160'), 160);
  assert.equal(p('$1,299.50'), 1299.5);
  assert.equal(p('EUR 120'), 120);
  assert.equal(p('2 for $100'), 100);
  assert.equal(p('from $90 to $120'), 90);
  assert.equal(p('about 80'), 80);
  assert.equal(p('free'), null);
  assert.equal(p(undefined), null);
});

test('formatTotal adds only USD and bare prices and counts the rest', async () => {
  const { formatTotal, currencyOf } = await import('../public/js/lib.js');
  const list = prices => prices.map(price => ({ price }));
  assert.equal(formatTotal(list(['$100', '120', ''])), '$220');
  assert.equal(formatTotal(list(['$100', 'EUR 120'])), '$100 + 1 in another currency');
  assert.equal(formatTotal(list(['£40', '€50', '10'])), '$10 + 2 in another currency');
  assert.equal(currencyOf({ price: 'EUR 120' }), 'EUR');
  assert.equal(currencyOf({ price: '$5' }), 'USD');
});

test('fashionStats splits wishlist and bought and ignores other currencies in the spread', async () => {
  const { fashionStats } = await import('../public/js/lib.js');
  const e = (price, extra = {}) => ({ price, style_tags: [], brand: 'A', bought: false, ...extra });
  const s = fashionStats([e('100'), e('300'), e('EUR 50'), e('80', { bought: true, brand: 'B' }), e('', { style_tags: ['Bought'], brand: 'B' })]);
  assert.deepEqual(s.wishlist, { count: 3, total: 400, other: 1 });
  assert.deepEqual(s.bought, { count: 2, total: 80, other: 0 });
  assert.deepEqual([s.average, s.min, s.max], [200, 100, 300]);
  assert.deepEqual(s.brands, [['A', 3], ['B', 2]]);
  assert.equal(fashionStats([]).average, null);
});

test('fuzzy search tolerates one typo per word', async () => {
  const { withinOneEdit, fuzzyMatch } = await import('../public/js/lib.js');
  assert.ok(withinOneEdit('barbor', 'barbour'));
  assert.ok(withinOneEdit('barbour', 'barbor'));
  assert.ok(withinOneEdit('coat', 'cost'));
  assert.ok(!withinOneEdit('coat', 'cart'));
  assert.ok(!withinOneEdit('coat', 'coating'));
  const jacket = { title: 'Beaufort Wax Jacket', brand: 'Barbour' };
  assert.ok(fuzzyMatch(jacket, 'barbor'));
  assert.ok(fuzzyMatch(jacket, 'wax jaket'));
  assert.ok(!fuzzyMatch(jacket, 'zzz'));
  assert.ok(!fuzzyMatch(jacket, 'ba')); // too short to guess
  assert.ok(!fuzzyMatch(jacket, ''));
});
