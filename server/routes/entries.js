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

  if (has('url')) out.url = cleanHttpUrl(body.url, 'url');
  if (has('title')) out.title = cleanString(body.title, 'title', 300);
  if (has('note')) out.note = cleanString(body.note, 'note', 10000);
  if (has('type')) out.type = optional(body.type) === null ? null : cleanString(body.type, 'type', 100) || null;
  if (has('color')) out.color = optional(body.color) === null ? null : cleanString(body.color, 'color', 50) || null;
  if (has('found_via')) out.found_via = optional(body.found_via) === null ? '' : cleanString(body.found_via, 'found_via', 100);
  if (has('favicon')) out.favicon = optional(body.favicon) === null ? null : cleanHttpUrl(body.favicon, 'favicon');
  for (const [f, max] of Object.entries(SPACES[currentSpace()].fields)) {
    if (has(f)) out[f] = cleanString(body[f], f, max);
  }
  for (const flag of ['favorite', 'pinned', 'bought']) {
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
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|igshid|mc_cid|mc_eid|ref|ref_src|_hsenc|_hsmi|variant|size|colou?r)$/i;

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
// ─── Entries ──────────────────────────────────────────────────────────────────
// Filtering/searching happens in the browser (it holds the full list), so this
// just returns everything, newest first.
router.get('/api/entries', (req, res) => {
  res.json([...readDB().entries].sort((a, b) => new Date(b.date_added) - new Date(a.date_added)));
});

// Is this URL already saved? Used by the add form as you type.
router.get('/api/duplicate', (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  res.json({ duplicate: url ? findDuplicate(readDB(), url, req.query.exclude) : null });
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
    screenshot: null,
    screenshots: [],
    remote_shots: [],
    palette: [],
    type: null,
    color: null,
    style_tags: [],
    note: '',
    found_via: '',
    favicon: null,
    favorite: false,
    pinned: false,
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
    entry.screenshot = null;
    entry.palette = [];
  }
  Object.assign(entry, fields);
  // Favoriting, pinning, marking bought and board moves aren't "edits" to the entry itself.
  if (Object.keys(fields).some(k => !['favorite', 'pinned', 'bought', 'boards'].includes(k))) entry.updated_at = new Date().toISOString();
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
  entry.screenshot = entry.screenshots[0] || null;
  if (i === 0) {
    entry.palette = entry.screenshot ? await extractPalette(path.join(UPLOADS_DIR, entry.screenshot)).catch(() => []) : [];
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
const BULK_ACTIONS = ['delete', 'tag', 'untag', 'setType', 'addToBoard', 'removeFromBoard', 'favorite'];
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
