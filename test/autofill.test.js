import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessFoundVia, applyCorrections, recordCorrections } from '../public/js/autofill.js';

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
