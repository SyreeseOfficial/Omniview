import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessBrand, guessOption, guessFashionFields, guessFoundVia, applyCorrections, recordCorrections, cleanTitle, recordReport, reportLines } from '../public/js/autofill.js';

test('guessFoundVia matches known hosts against your own list only', () => {
  const list = ['Dribbble', 'Pinterest', 'Reddit'];
  assert.equal(guessFoundVia('https://www.pinterest.co.uk/pin/1', list), 'Pinterest');
  assert.equal(guessFoundVia('https://dribbble.com/shots/1', list), 'Dribbble');
  assert.equal(guessFoundVia('https://instagram.com/p/1', list), ''); // not in the list
  assert.equal(guessFoundVia('https://notpinterest.com/', list), '');
});

test('a corrected type is remembered per host and replaces the same guess next time', () => {
  const url = 'https://shop.example/a';
  const raw = { type: 'Jacket', color: 'Black' };
  const store = recordCorrections(raw, raw, { type: 'Knitwear', color: 'Black' }, url, {});
  assert.deepEqual(store, { 'shop.example': { type: { Jacket: 'Knitwear' } } });
  assert.deepEqual(applyCorrections({ type: 'Jacket', color: 'Black' }, 'https://shop.example/b', store), { type: 'Knitwear', color: 'Black' });
  assert.equal(applyCorrections({ type: 'Jacket' }, 'https://other.example/', store).type, 'Jacket');
});

const lists = { entries: [], types: ['Jacket', 'Shirt', 'Shoes', 'Boots'], colors: ['Black', 'Red', 'Gray', 'Blue'] };

test('guessBrand prefers a known brand over the page text, then the shop\'s prior brand, then the page', () => {
  const entries = [
    { brand: 'Bronson MFG', url: 'https://shop.example/a' },
    { brand: 'Bronson MFG', url: 'https://shop.example/b' }
  ];
  assert.equal(guessBrand({ brand: 'Bronson Mfg. Co.' }, 'https://x.example/p', entries), 'Bronson MFG'); // known wins
  assert.equal(guessBrand({}, 'https://www.shop.example/c', entries), 'Bronson MFG'); // per-host prior (www. ignored)
  assert.equal(guessBrand({ brand: 'Barbour' }, 'https://other.example/c', entries), 'Barbour'); // page's own
  assert.equal(guessBrand({ siteName: 'Shop' }, 'https://other.example/c', []), 'Shop');
  assert.equal(guessBrand({}, 'https://other.example/c', []), '');
});

test('guessBrand only trusts a host\'s prior brand when it is unambiguous', () => {
  const one = [{ brand: 'A', url: 'https://s.example/1' }];
  const mixed = [{ brand: 'A', url: 'https://s.example/1' }, { brand: 'B', url: 'https://s.example/2' }];
  assert.equal(guessBrand({}, 'https://s.example/3', one), ''); // needs two entries
  assert.equal(guessBrand({}, 'https://s.example/3', mixed), '');
});

test('guessOption skips a source that mentions two options and falls to the next', () => {
  const types = ['Jacket', 'Shirt'];
  assert.equal(guessOption(types, ['Shirt jacket', 'Wool jacket']), 'Jacket');
  assert.equal(guessOption(types, ['Shirt jacket']), ''); // ambiguous everywhere
  assert.equal(guessOption(types, ['Two jackets']), 'Jacket'); // plural
  assert.equal(guessOption(['Gray'], ['grey wool'], { Gray: ['grey'] }), 'Gray'); // alias
  assert.equal(guessOption(types, [null, '']), '');
});

test('guessFashionFields does not read the brand as a color ("Red Wing")', () => {
  const info = { title: 'Red Wing Iron Ranger Boots', brand: 'Red Wing', price: '320', color: '', category: '' };
  const g = guessFashionFields(info, 'https://shop.example/red-wing-boots', { ...lists, entries: [{ brand: 'Red Wing', url: 'https://x.example/1' }] });
  assert.equal(g.brand, 'Red Wing');
  assert.equal(g.color, ''); // scrubbed
  assert.equal(g.type, 'Boots');
  assert.equal(guessFashionFields({ ...info, brand: '' }, 'https://shop.example/x', lists).color, 'Red'); // without a brand it is a color
});

test('guessFashionFields formats the price: whole dollars, other currencies prefixed', () => {
  const at = (price, currency) => guessFashionFields({ title: '', price, currency }, 'https://s.example/', lists).price;
  assert.equal(at('49.99', 'USD'), 50);
  assert.equal(at('120', null), 120);
  assert.equal(at('120', 'EUR'), 'EUR 120');
  assert.equal(at(null, 'EUR'), '');
});

test('guessFashionFields uses the URL path as a last source and takes the page category first', () => {
  const g = guessFashionFields({ title: '', category: 'Shirts' }, 'https://s.example/products/wool-shirt-jacket', lists);
  assert.equal(g.type, 'Shirt'); // category mentions one type, the path mentions two
  assert.equal(guessFashionFields({ title: '' }, 'https://s.example/products/leather-shoes', lists).type, 'Shoes');
});

test('guessFashionFields reports which fields it skipped and why', () => {
  const g = guessFashionFields({ title: 'Shirt jacket', price: '90', color: 'black and red' }, 'https://s.example/', lists);
  assert.deepEqual(g.skipped, { type: 2, color: 2 });
  assert.equal(g.type, '');
  assert.deepEqual(guessFashionFields({ title: 'Wool jacket' }, 'https://s.example/', { ...lists, types: ['Jacket'] }).skipped, {});
});

test('cleanTitle drops a trailing site name but nothing else', () => {
  assert.equal(cleanTitle('Pricing | Stripe', null, 'https://stripe.com/pricing'), 'Pricing');
  assert.equal(cleanTitle('Dashboard - Linear', 'Linear', 'https://linear.app/'), 'Dashboard');
  assert.equal(cleanTitle('Docs – Stripe Docs', null, 'https://docs.stripe.com/'), 'Docs');
  assert.equal(cleanTitle('Design - Systems', null, 'https://stripe.com/'), 'Design - Systems'); // tail is not the site
  assert.equal(cleanTitle('Stripe', 'Stripe', 'https://stripe.com/'), 'Stripe');
  assert.equal(cleanTitle('A - Stripe', null, 'https://stripe.com/'), 'A - Stripe'); // too little left
  assert.equal(cleanTitle('Well-known thing', null, 'https://well.example/'), 'Well-known thing'); // hyphen without spaces
});

test('the autofill report counts empty fields per shop', () => {
  const report = {};
  recordReport(report, 'https://www.bronsonshop.com/a', { brand: 'Bronson', color: '' });
  recordReport(report, 'https://bronsonshop.com/b', { brand: 'Bronson', color: '' });
  recordReport(report, 'https://bronsonshop.com/c', { brand: '', color: 'Black' });
  recordReport(report, 'https://fine.example/', { brand: 'X', color: 'Red' });
  assert.deepEqual(reportLines(report), ['bronsonshop.com: color missing 2/3, brand missing 1/3']);
});
