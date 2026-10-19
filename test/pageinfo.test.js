'use strict';

// pageInfo against markup shaped like real shops. Autofill is built on it, so a
// regression here silently blanks the Add form.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pageInfo, politeWait } = require('../server/unfurl');

const page = (head, body = '') => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

test('Shopify: ProductGroup JSON-LD with variants, og tags and a protocol-relative image', () => {
  const html = page(`
    <title>Heritage Jacket &ndash; Bronson Shop</title>
    <meta property="og:site_name" content="Bronson Shop">
    <meta property="og:title" content="Heritage Jacket">
    <meta property="og:image" content="//cdn.shopify.com/s/files/1/0001/products/jacket_1200x.jpg?v=1">
    <meta property="og:price:amount" content="189.00"><meta property="og:price:currency" content="USD">
    <link rel="icon" href="//cdn.shopify.com/s/files/1/0001/favicon.png">
    ${ld({ '@context': 'http://schema.org/', '@type': 'ProductGroup', name: 'Heritage Jacket', brand: { '@type': 'Brand', name: 'Bronson Mfg.' }, color: 'Olive',
      hasVariant: [{ '@type': 'Product', offers: { '@type': 'Offer', price: '189.00', priceCurrency: 'USD', availability: 'http://schema.org/InStock' } }] })}`);
  const info = pageInfo(html, 'https://bronsonshop.com/products/heritage-jacket');
  assert.equal(info.title, 'Heritage Jacket');
  assert.equal(info.brand, 'Bronson Mfg.');
  assert.equal(info.siteName, 'Bronson Shop');
  assert.equal(info.price, '189');
  assert.equal(info.currency, 'USD');
  assert.equal(info.availability, 'InStock');
  assert.equal(info.color, 'Olive');
  assert.equal(info.image, 'https://cdn.shopify.com/s/files/1/0001/products/jacket_1200x.jpg?v=1');
  assert.equal(info.favicon, 'https://cdn.shopify.com/s/files/1/0001/favicon.png');
});

test('WooCommerce: Product inside a JSON-LD @graph, offers as an array with a priceSpecification', () => {
  const html = page(ld({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [] },
    { '@type': 'Product', name: 'Wool Overcoat', category: 'Coats', image: 'https://shop.example/wp-content/coat.jpg',
      offers: [{ '@type': 'Offer', priceSpecification: [{ '@type': 'UnitPriceSpecification', price: '320.00', priceCurrency: 'EUR' }], priceCurrency: 'EUR' }] }
  ] }), '<h1>Wool Overcoat</h1>');
  const info = pageInfo(html, 'https://shop.example/product/wool-overcoat/');
  assert.equal(info.price, '320');
  assert.equal(info.currency, 'EUR');
  assert.equal(info.category, 'Coats');
  assert.equal(info.image, 'https://shop.example/wp-content/coat.jpg');
});

test('Squarespace: no JSON-LD, og:price and product:* meta', () => {
  const html = page(`
    <meta property="og:title" content="Canvas Tote — Field Co">
    <meta property="og:site_name" content="Field Co">
    <meta property="og:image" content="https://images.squarespace-cdn.com/content/tote.jpg">
    <meta property="product:price:amount" content="45.00"><meta property="product:price:currency" content="USD">
    <meta property="product:brand" content="Field Co"><meta property="product:availability" content="instock">
    <meta property="og:product:category" content="Bags">`);
  const info = pageInfo(html, 'https://fieldco.example/shop/canvas-tote');
  assert.equal(info.title, 'Canvas Tote — Field Co');
  assert.equal(info.price, '45');
  assert.equal(info.brand, 'Field Co');
  assert.equal(info.availability, 'instock');
  assert.equal(info.category, 'Bags');
});

test('AggregateOffer takes the lowest price', () => {
  const html = page(ld({ '@type': 'Product', name: 'Boot', offers: { '@type': 'AggregateOffer', lowPrice: '210.50', highPrice: '260', priceCurrency: 'USD' } }));
  const info = pageInfo(html, 'https://shop.example/boot');
  assert.equal(info.price, '210.5');
  assert.equal(info.currency, 'USD');
});

test('offers as an array uses the first offer', () => {
  const html = page(ld({ '@type': 'Product', name: 'Hat', offers: [{ price: 30, priceCurrency: 'GBP' }, { price: 35, priceCurrency: 'GBP' }] }));
  const info = pageInfo(html, 'https://shop.example/hat');
  assert.equal(info.price, '30');
  assert.equal(info.currency, 'GBP');
});

test('priceSpecification as a single object and as an array', () => {
  const one = ld({ '@type': 'Product', offers: { priceSpecification: { price: '99', priceCurrency: 'USD' } } });
  const many = ld({ '@type': 'Product', offers: { priceSpecification: [{ price: '99', priceCurrency: 'USD' }, { price: '120', priceCurrency: 'USD' }] } });
  assert.equal(pageInfo(page(one), 'https://s.example/').price, '99');
  assert.equal(pageInfo(page(many), 'https://s.example/').price, '99');
});

test('hasVariant: the first variant\'s offer is used when the group has none', () => {
  const html = page(ld({ '@type': 'ProductGroup', hasVariant: [
    { '@type': 'Product', color: 'Navy', offers: { price: '75', priceCurrency: 'USD' } },
    { '@type': 'Product', color: 'Grey', offers: { price: '80', priceCurrency: 'USD' } }
  ] }));
  assert.equal(pageInfo(html, 'https://s.example/').price, '75');
});

test('currency symbols in the price text become ISO codes', () => {
  const html = page(ld({ '@type': 'Product', offers: { price: '£1,250.00' } }));
  const info = pageInfo(html, 'https://s.example/');
  assert.equal(info.price, '1250');
  assert.equal(info.currency, 'GBP');
});

test('microdata and data-price are used when there is no JSON-LD', () => {
  assert.equal(pageInfo(page('', '<span itemprop="price" content="12.5">$12.50</span>'), 'https://s.example/').price, '12.5');
  assert.equal(pageInfo(page('', '<div class="buy" data-price="48.00">'), 'https://s.example/').price, '48');
});

test('malformed JSON-LD is skipped and later blocks still count', () => {
  const html = page(`<script type="application/ld+json">{ not json</script>${ld({ '@type': 'Product', offers: { price: '10' } })}`);
  assert.equal(pageInfo(html, 'https://s.example/').price, '10');
});

test('images are deduplicated across http/https and query strings, and limited to urls', () => {
  const html = page(`
    <meta property="og:image" content="https://cdn.example/a.jpg?v=1">
    <meta property="og:image" content="http://cdn.example/a.jpg?v=2">
    ${ld({ '@type': 'Product', image: ['https:files/bad.jpg', '/media/b.jpg', { url: 'https://cdn.example/c.jpg' }] })}`);
  assert.deepEqual(pageInfo(html, 'https://shop.example/p').images, ['https://cdn.example/a.jpg?v=1', 'https://shop.example/media/b.jpg', 'https://cdn.example/c.jpg']);
});

test('a page with nothing useful gives nulls, not a crash', () => {
  const info = pageInfo('<html></html>', 'https://s.example/x');
  assert.equal(info.title, '');
  assert.equal(info.price, null);
  assert.equal(info.brand, null);
  assert.equal(info.image, null);
});

test('the same picture at several sizes collapses to the largest; tiny images are not the default cover', () => {
  const html = page(`
    <meta property="og:image" content="https://cdn.shopify.com/files/logo_80x.png">
    <meta property="og:image" content="https://cdn.shopify.com/files/coat_300x.jpg?v=1">
    ${ld({ '@type': 'Product', image: ['https://cdn.shopify.com/files/coat_1200x.jpg', 'https://cdn.shopify.com/files/coat.jpg?width=600', 'https://cdn.shopify.com/files/side.jpg'] })}`);
  const info = pageInfo(html, 'https://shop.example/p');
  assert.equal(info.image, 'https://cdn.shopify.com/files/coat_1200x.jpg'); // largest of the coat sizes; the logo is skipped
  assert.deepEqual(info.images, ['https://cdn.shopify.com/files/coat_1200x.jpg', 'https://cdn.shopify.com/files/logo_80x.png', 'https://cdn.shopify.com/files/side.jpg']);
});

test('the canonical link comes from rel=canonical, else og:url', () => {
  const withLink = page('<link rel="canonical" href="/products/hat"><meta property="og:url" content="https://other.example/x">');
  assert.equal(pageInfo(withLink, 'https://shop.example/products/hat?utm_source=x').canonical, 'https://shop.example/products/hat');
  assert.equal(pageInfo(page('<meta property="og:url" content="https://shop.example/p">'), 'https://shop.example/p?a=1').canonical, 'https://shop.example/p');
  assert.equal(pageInfo(page(''), 'https://shop.example/p').canonical, null);
});

test('page fetches to one host are spaced a second apart; local addresses and other hosts are not', async () => {
  const t0 = Date.now();
  await politeWait('https://rate-a.example/1');
  await politeWait('https://rate-b.example/1');
  await politeWait('http://127.0.0.1:1/1');
  await politeWait('http://127.0.0.1:1/2');
  assert.ok(Date.now() - t0 < 500);
  await politeWait('https://rate-a.example/2');
  assert.ok(Date.now() - t0 >= 950);
});
