'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { UPLOADS_DIR, SPACES, currentSpace, readDB, writeDB, removeFiles, trashEntry, bindSpace } = require('../store');
const { upload, attachScreenshot, extractPalette } = require('../images');
const { httpError, cleanString, cleanList, cleanHttpUrl, canon, optional } = require('../validate');

const router = express.Router();
const MAX_BULK_IDS = 5000;

// Validates (and for managed lists, registers) the writable fields of an entry.
// Only keys present in `body` are returned, so PUT stays a partial update.
function cleanEntryFields(body, db, create) {
  const out = {};
  const has = k => body[k] !== undefined;
  if (create && !has('url')) throw httpError(400, 'url is required');

  if (has('url')) out.url = stripTracking(cleanHttpUrl(body.url, 'url'));
  if (has('title')) out.title = cleanString(body.title, 'title', 300);
  if (has('note')) out.note = cleanString(body.note, 'note', 10000);
  if (has('type')) out.type = optional(body.type) === null ? null : cleanString(body.type, 'type', 100) || null;
  if (has('color')) out.color = optional(body.color) === null ? null : cleanString(body.color, 'color', 50) || null;
  if (has('found_via')) out.found_via = optional(body.found_via) === null ? '' : cleanString(body.found_via, 'found_via', 100);
  if (has('favicon')) out.favicon = optional(body.favicon) === null ? null : cleanHttpUrl(body.favicon, 'favicon');
  for (const [f, max] of Object.entries(SPACES[currentSpace()].fields)) {
    if (has(f)) out[f] = cleanString(body[f], f, max);
  }
  for (const flag of ['favorite', 'bought']) {
    if (!has(flag)) continue;
    if (typeof body[flag] !== 'boolean') throw httpError(400, `${flag} must be a boolean`);
    out[flag] = body[flag];
  }
  if (has('style_tags')) out.style_tags = cleanList(body.style_tags, 'style_tags', 100);
  if (has('boards')) {
    const ids = new Set(db.boards.map(b => b.id));
    out.boards = cleanList(body.boards, 'boards', 100).filter(id => ids.has(id));
  }

  // Validation done: nothing below can throw, so registering is safe.
  if (out.style_tags) out.style_tags = [...new Set(out.style_tags.map(t => canon(db.tags, t)))];
  if (out.type) out.type = canon(db.types, out.type);
  if (out.found_via) out.found_via = canon(db.foundVia, out.found_via);
  return out;
}

// ─── Duplicate URLs ───────────────────────────────────────────────────────────
// Two URLs are "the same page" when they differ only by scheme, www., a trailing
// slash, the #fragment, parameter order, tracking parameters, or a size/color variant
// (?variant=123), or, on Shopify, the /collections/<x> prefix of a /products/<handle> link.
const TRACKING = 'utm_.*|fbclid|gclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi';
const TRACKING_PARAM = new RegExp(`^(${TRACKING}|ref|ref_src|variant|size|colou?r)$`, 'i');
const SAVED_TRACKING_PARAM = new RegExp(`^(${TRACKING})$`, 'i'); // the same junk, but variant/size/colour are part of the link you chose

// The URL as saved: ad-click parameters dropped, everything else (including an untouched string) kept.
function stripTracking(url) {
  const u = new URL(url);
  const junk = [...u.searchParams.keys()].filter(k => SAVED_TRACKING_PARAM.test(k));
  if (!junk.length) return url;
  junk.forEach(k => u.searchParams.delete(k));
  return u.href;
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = new URLSearchParams(params).toString();
    const path = u.pathname.replace(/\/+$/, '').replace(/^\/collections\/[^/]+(?=\/products\/)/, '');
    return `${u.host.toLowerCase().replace(/^www\./, '')}${path}${query ? `?${query}` : ''}`;
  } catch {
    return raw;
  }
}

function findDuplicate(db, url, excludeId) {
  const key = normalizeUrl(url);
  return db.entries.find(e => e.id !== excludeId && normalizeUrl(e.url) === key) || null;
}

// Another colourway of the same product, saved as its own entry: same shop, same price, same
// title before the " - Olive" / " | Shop" tail. Only a hint, so it never blocks saving.
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const titleStem = t => t.split(/\s[-–—|]\s/)[0].trim().toLowerCase();

function findColourway(db, { url, title, price }, excludeId) {
  const stem = titleStem(title);
  if (!stem || !price) return null;
  return db.entries.find(e => e.id !== excludeId && hostOf(e.url) === hostOf(url) && e.price === price && titleStem(e.title) === stem && normalizeUrl(e.url) !== normalizeUrl(url)) || null;
}

// ─── Entries ──────────────────────────────────────────────────────────────────
// Filtering, searching and sorting happen in the browser (it holds the full list),
// so this just returns everything in stored order.
router.get('/api/entries', (req, res) => {
  res.json(readDB().entries);
});

// Is this URL already saved (or a colourway of a saved entry)? Used by the add form as you type.
router.get('/api/duplicate', (req, res) => {
  const str = k => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const url = str('url');
  const db = readDB();
  res.json({
    duplicate: url ? findDuplicate(db, url, req.query.exclude) : null,
    colourway: url ? findColourway(db, { url, title: str('title'), price: str('price') }, req.query.exclude) : null
  });
});

// Get single entry
router.get('/api/entries/:id', (req, res) => {
  const entry = readDB().entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

// Create entry. An already-saved URL is refused with 409 unless `force` is set.
router.post('/api/entries', (req, res) => {
  const db = readDB();
  const fields = cleanEntryFields(req.body, db, true);
  const existing = findDuplicate(db, fields.url);
  if (existing && req.body.force !== true) {
    return res.status(409).json({ error: 'That URL is already saved', duplicate: existing });
  }

  const entry = {
    id: crypto.randomUUID(),
    title: '',
    screenshots: [],
    remote_shots: [],
    palette: [],
    image_hashes: {},
    type: null,
    color: null,
    style_tags: [],
    note: '',
    found_via: '',
    favicon: null,
    favorite: false,
    bought: false,
    visited_at: null,
    boards: [],
    date_added: new Date().toISOString(),
    ...Object.fromEntries(Object.keys(SPACES[currentSpace()].fields).map(f => [f, ''])),
    ...fields
  };

  db.entries.push(entry);
  writeDB(db);
  res.status(201).json({ entry, isDuplicate: !!existing });
});

// Update entry
router.put('/api/entries/:id', (req, res) => {
  const db = readDB();
  const entry = db.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  const fields = cleanEntryFields(req.body, db, false);
  if (req.body.removeScreenshot) {
    entry.screenshots.forEach(removeFiles);
    entry.screenshots = [];
    entry.remote_shots = [];
    entry.image_hashes = {};
    entry.palette = [];
  }
  Object.assign(entry, fields);
  // Favoriting, marking bought and board moves aren't "edits" to the entry itself.
  if (Object.keys(fields).some(k => !['favorite', 'bought', 'boards'].includes(k))) entry.updated_at = new Date().toISOString();
  writeDB(db);
  res.json(entry);
});

// Records that the entry's site was opened ("visited" badge). Not an edit, so updated_at is left alone.
router.post('/api/visit', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every(i => typeof i === 'string')) throw httpError(400, 'ids must be an array of at most 200 ids');
  const db = readDB();
  const wanted = new Set(ids);
  const visited_at = new Date().toISOString();
  const hits = db.entries.filter(e => wanted.has(e.id));
  hits.forEach(e => { e.visited_at = visited_at; });
  if (hits.length) writeDB(db);
  res.json({ visited_at, count: hits.length });
});

// Add a screenshot (the first one becomes the cover)
router.post('/api/entries/:id/screenshot', upload.single('screenshot'), bindSpace, async (req, res) => {
  if (!req.file) throw httpError(400, 'No file uploaded');
  const { entry, duplicateOf } = await attachScreenshot(req.params.id, req.file.filename);
  res.json({ screenshot: req.file.filename, screenshots: entry.screenshots, duplicateOf });
});

// Remove one screenshot; the palette follows whichever image is now the cover.
router.delete('/api/entries/:id/screenshots/:file', async (req, res) => {
  const entry = readDB().entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const i = entry.screenshots.indexOf(req.params.file);
  if (i === -1) return res.status(404).json({ error: 'Screenshot not found' });
  entry.screenshots.splice(i, 1);
  entry.remote_shots = entry.remote_shots.filter(f => f !== req.params.file);
  removeFiles(req.params.file);
  delete entry.image_hashes[req.params.file];
  if (i === 0) {
    entry.palette = entry.screenshots[0] ? await extractPalette(path.join(UPLOADS_DIR, entry.screenshots[0])).catch(() => []) : [];
  }
  writeDB(readDB());
  res.json(entry);
});

// Delete entry
router.delete('/api/entries/:id', (req, res) => {
  const db = readDB();
  const idx = db.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  trashEntry(db, db.entries[idx]);
  writeDB(db);
  res.json({ ok: true });
});

// Bulk actions
const BULK_ACTIONS = ['delete', 'tag', 'untag', 'setType', 'setBrand', 'setColor', 'setFoundVia', 'addToBoard', 'removeFromBoard', 'favorite'];
router.post('/api/entries/bulk', (req, res) => {
  const { ids, action } = req.body;
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw httpError(400, 'ids array required');
  if (ids.length > MAX_BULK_IDS) throw httpError(400, `At most ${MAX_BULK_IDS} ids per request`);
  if (!BULK_ACTIONS.includes(action)) throw httpError(400, 'Unknown bulk action');
  const db = readDB();
  const wanted = new Set(ids);
  const targets = db.entries.filter(e => wanted.has(e.id));
  // Nothing matched: skip the write (and the side effects of registering a new tag/type).
  const results = () => ids.map(id => ({ id, updated: targets.some(e => e.id === id) }));
  if (!targets.length) return res.json({ ok: true, updated: 0, results: results() });

  const boardIds = () => {
    const wanted = cleanList([].concat(req.body.boards ?? []), 'boards', 100);
    return wanted.filter(id => db.boards.some(b => b.id === id));
  };
  // Resolve and validate the action's argument once, before touching any entry.
  let apply;
  switch (action) {
    case 'delete':
      apply = e => trashEntry(db, e);
      break;
    case 'tag': {
      const tag = canon(db.tags, cleanString(req.body.tag, 'tag', 100));
      apply = e => { if (!e.style_tags.includes(tag)) e.style_tags.push(tag); };
      break;
    }
    case 'untag': {
      const tag = cleanString(req.body.tag, 'tag', 100);
      apply = e => { e.style_tags = e.style_tags.filter(t => t !== tag); };
      break;
    }
    case 'setType': {
      const raw = optional(req.body.type) === null ? '' : cleanString(req.body.type, 'type', 100);
      const type = raw ? canon(db.types, raw) : null;
      apply = e => { e.type = type; };
      break;
    }
    case 'setBrand': {
      if (!('brand' in SPACES[currentSpace()].fields)) throw httpError(400, 'This library has no brand field');
      const brand = optional(req.body.brand) === null ? '' : cleanString(req.body.brand, 'brand', SPACES[currentSpace()].fields.brand);
      apply = e => { e.brand = brand; };
      break;
    }
    case 'setColor': {
      const color = optional(req.body.color) === null ? null : cleanString(req.body.color, 'color', 50) || null;
      apply = e => { e.color = color; };
      break;
    }
    case 'setFoundVia': {
      const via = optional(req.body.foundVia) === null ? '' : canon(db.foundVia, cleanString(req.body.foundVia, 'foundVia', 100));
      apply = e => { e.found_via = via; };
      break;
    }
    case 'addToBoard': {
      const add = boardIds();
      apply = e => add.forEach(b => { if (!e.boards.includes(b)) e.boards.push(b); });
      break;
    }
    case 'removeFromBoard': {
      const drop = boardIds();
      apply = e => { e.boards = e.boards.filter(b => !drop.includes(b)); };
      break;
    }
    case 'favorite': {
      if (typeof req.body.value !== 'boolean') throw httpError(400, 'value must be a boolean');
      const value = req.body.value;
      apply = e => { e.favorite = value; };
      break;
    }
    default:
      throw httpError(400, 'Unknown bulk action');
  }

  const now = new Date().toISOString();
  targets.forEach(e => {
    apply(e);
    if (action !== 'delete' && action !== 'favorite' && !/Board$/.test(action)) e.updated_at = now;
  });
  writeDB(db);
  res.json({ ok: true, updated: targets.length, results: results() });
});

module.exports = router;
