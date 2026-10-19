'use strict';

const express = require('express');
const { TRASH_DAYS, readDB, writeDB, removeFiles, purgeTrash } = require('../store');
const { canon } = require('../validate');

const router = express.Router();

router.get('/api/trash', (req, res) => {
  purgeTrash();
  res.json([...readDB().trash].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)).map(e => ({ ...e, days_left: Math.max(0, Math.ceil(TRASH_DAYS - (Date.now() - Date.parse(e.deleted_at)) / 864e5)) })));
});

router.post('/api/trash/:id/restore', (req, res) => {
  const db = readDB();
  const i = db.trash.findIndex(e => e.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not in the trash' });
  const [entry] = db.trash.splice(i, 1);
  delete entry.deleted_at;
  // Lists and boards may have changed while it was away.
  entry.style_tags = entry.style_tags.map(t => canon(db.tags, t));
  if (entry.type) entry.type = canon(db.types, entry.type);
  if (entry.found_via) entry.found_via = canon(db.foundVia, entry.found_via);
  entry.boards = entry.boards.filter(id => db.boards.some(b => b.id === id));
  db.entries.push(entry);
  writeDB(db);
  res.json(entry);
});

router.delete('/api/trash/:id', (req, res) => {
  const db = readDB();
  const entry = db.trash.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not in the trash' });
  db.trash.splice(db.trash.indexOf(entry), 1);
  entry.screenshots.forEach(removeFiles);
  writeDB(db);
  res.json({ ok: true });
});

router.delete('/api/trash', (req, res) => {
  purgeTrash(true);
  res.json({ ok: true });
});

module.exports = router;
