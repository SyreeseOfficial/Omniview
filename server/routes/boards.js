'use strict';

const crypto = require('crypto');
const express = require('express');
const { readDB, writeDB } = require('../store');
const { httpError, cleanString, cleanList } = require('../validate');

const router = express.Router();

// ─── Boards ───────────────────────────────────────────────────────────────────
router.get('/api/boards', (req, res) => {
  const db = readDB();
  const counts = {};
  db.entries.forEach(e => e.boards.forEach(b => { counts[b] = (counts[b] || 0) + 1; }));
  res.json(db.boards.map(b => ({ ...b, count: counts[b.id] || 0 })));
});

// Writable board fields; only keys present in `body` are returned, like cleanEntryFields.
function cleanBoardFields(body) {
  const out = {};
  const has = k => body[k] !== undefined;
  if (has('name')) {
    out.name = cleanString(body.name, 'name', 100);
    if (!out.name) throw httpError(400, 'name required');
  }
  if (has('description')) out.description = cleanString(body.description, 'description', 1000);
  if (has('emoji')) out.emoji = cleanString(body.emoji, 'emoji', 16);
  if (has('color')) {
    out.color = cleanString(body.color, 'color', 7);
    if (out.color && !/^#[0-9a-f]{6}$/i.test(out.color)) throw httpError(400, 'color must be a #rrggbb hex value');
  }
  if (has('pinned')) {
    if (typeof body.pinned !== 'boolean') throw httpError(400, 'pinned must be a boolean');
    out.pinned = body.pinned;
  }
  return out;
}

router.post('/api/boards', (req, res) => {
  const fields = cleanBoardFields({ ...req.body, name: req.body.name ?? '' });
  const db = readDB();
  const board = { id: crypto.randomUUID(), description: '', emoji: '', color: '', pinned: false, order: [], created: new Date().toISOString(), ...fields };
  db.boards.push(board);
  writeDB(db);
  res.status(201).json(board);
});

// Drag-to-reorder: `ids` is the full new order. Registered before /:id so "order" isn't read as an id.
router.put('/api/boards/order', (req, res) => {
  const db = readDB();
  const ids = cleanList(req.body.ids, 'ids', 100);
  const byId = new Map(db.boards.map(b => [b.id, b]));
  const listed = ids.filter(id => byId.has(id));
  db.boards = [...listed.map(id => byId.get(id)), ...db.boards.filter(b => !listed.includes(b.id))];
  writeDB(db);
  res.json({ ok: true });
});

// Manual order of the entries inside one board (ids of entries not in the list sort after it).
router.put('/api/boards/:id/order', (req, res) => {
  const db = readDB();
  const board = db.boards.find(b => b.id === req.params.id);
  if (!board) return res.status(404).json({ error: 'Not found' });
  const known = new Set(db.entries.map(e => e.id));
  board.order = cleanList(req.body.ids, 'ids', 100).filter(id => known.has(id));
  writeDB(db);
  res.json(board);
});

router.put('/api/boards/:id', (req, res) => {
  const db = readDB();
  const board = db.boards.find(b => b.id === req.params.id);
  if (!board) return res.status(404).json({ error: 'Not found' });
  Object.assign(board, cleanBoardFields(req.body));
  writeDB(db);
  res.json(board);
});

router.delete('/api/boards/:id', (req, res) => {
  const db = readDB();
  const idx = db.boards.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.boards.splice(idx, 1);
  // Remove board from all entries
  db.entries.forEach(e => {
    e.boards = e.boards.filter(bid => bid !== req.params.id);
  });
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
