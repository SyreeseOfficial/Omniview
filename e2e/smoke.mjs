// Browser smoke test: add an entry, tag it, favorite it, delete it, undo the delete.
// Optional on purpose (not part of `npm test`): it needs Playwright and a browser.
//   npm i -D playwright && npx playwright install chromium && npm run e2e
// PLAYWRIGHT_CHROMIUM_PATH points at an existing Chromium instead.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('Playwright is not installed: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniview-e2e-'));
const port = 3900 + Math.floor(Math.random() * 90);
const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(port), OMNIVIEW_DB_PATH: path.join(dir, 'library.json'), OMNIVIEW_UPLOADS_DIR: path.join(dir, 'uploads') },
  stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => String(d).includes('running at') && resolve());
  server.on('exit', code => reject(new Error(`server exited with ${code}`)));
});

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);

  // add
  await page.click('.nav-add');
  await page.fill('#f-url', 'https://smoke.example/page');
  await page.fill('#f-title', 'Smoke test entry');
  // tag
  await page.fill('#tag-search', 'Smoky');
  await page.press('#tag-search', 'Enter');
  assert.equal(await page.locator('#tag-pills .tag-pill, #tag-pills > *').count() > 0, true, 'the tag pill shows up');
  await page.click('#form-submit');
  await page.waitForSelector('.entry-card');
  assert.equal(await page.locator('.entry-card').count(), 1);
  assert.match(await page.locator('.card-tags').textContent(), /Smoky/);

  // favorite
  await page.hover('.entry-card');
  await page.click('.card-fav');
  await page.waitForSelector('.card-fav.is-fav');

  // delete, then undo
  await page.click('.entry-card .thumb-wrap');
  await page.click('#detail-delete');
  await page.click('#confirm-ok');
  await page.waitForSelector('.toast-action');
  assert.equal(await page.locator('.entry-card').count(), 0, 'deleted entries leave the list');
  await page.click('.toast-action');
  await page.waitForSelector('.entry-card');
  assert.equal(await page.locator('.entry-card').count(), 1, 'undo brings it back');
  assert.deepEqual(errors, [], 'no uncaught errors in the page');
  console.log('smoke test passed');
} finally {
  await browser.close();
  server.removeAllListeners('exit');
  const stopped = new Promise(resolve => server.once('exit', resolve));
  server.kill(); // it saves on the way out, so wait before removing the folder
  await stopped;
  fs.rmSync(dir, { recursive: true, force: true });
}
