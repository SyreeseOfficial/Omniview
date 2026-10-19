'use strict';

// The managed lists (tags, types, found via) share one set of routes.
const express = require('express');
const { readDB, writeDB } = require('../store');
const { httpError, cleanString, cleanList, canon } = require('../validate');

const router = express.Router();

// Shared by tags/types/found-via create + rename: trims, rejects blank, and
// rejects a case-insensitive collision with an existing option. `self` is the
// option's own current name (excluded from the collision check) when renaming.
function validateOptionName(name, list, self) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return { error: 'name required', status: 400 };
  if (trimmed.length > 100) return { error: 'name is too long', status: 400 };
  const dupe = list.some(o => o.toLowerCase() === trimmed.toLowerCase() && o !== self);
  if (dupe) return { error: 'That name already exists', status: 409 };
  return { value: trimmed };
}

// GET / POST / PUT :name / DELETE :name for one list. `key` is where it lives in the
// library (and the key of every answer); `onRename` and `onDelete` fix up the entries.
function managedList(base, key, noun, onRename, onDelete) {
  router.get(base, (req, res) => res.json(readDB()[key]));

  router.post(base, (req, res) => {
    const db = readDB();
    const v = validateOptionName(req.body.name, db[key]);
    if (v.error) return res.status(v.status).json({ error: v.error });
    db[key].push(v.value);
    writeDB(db);
    res.status(201).json({ [key]: db[key] });
  });

  router.put(`${base}/:name`, (req, res) => {
    const db = readDB();
    const oldName = req.params.name;
    const idx = db[key].indexOf(oldName);
    if (idx === -1) return res.status(404).json({ error: `${noun} not found` });
    const v = validateOptionName(req.body.newName, db[key], oldName);
    if (v.error) return res.status(v.status).json({ error: v.error });
    db[key][idx] = v.value;
    db.entries.forEach(e => onRename(e, oldName, v.value));
    writeDB(db);
    res.json({ [key]: db[key] });
  });

  router.delete(`${base}/:name`, (req, res) => {
    const db = readDB();
    const name = req.params.name;
    if (!db[key].includes(name)) return res.status(404).json({ error: `${noun} not found` });
    db[key] = db[key].filter(x => x !== name);
    db.entries.forEach(e => onDelete(e, name));
    writeDB(db);
    res.json({ [key]: db[key] });
  });
}

managedList('/api/tags', 'tags', 'Tag',
  (e, from, to) => { e.style_tags = e.style_tags.map(t => (t === from ? to : t)); },
  (e, name) => { e.style_tags = e.style_tags.filter(t => t !== name); });
managedList('/api/types', 'types', 'Type',
  (e, from, to) => { if (e.type === from) e.type = to; },
  (e, name) => { if (e.type === name) e.type = null; });
managedList('/api/found-via', 'foundVia', 'Found via option',
  (e, from, to) => { if (e.found_via === from) e.found_via = to; },
  (e, name) => { if (e.found_via === name) e.found_via = ''; });

// Merge several tags into one (an existing tag, or a new name).
router.post('/api/tags/merge', (req, res) => {
  const db = readDB();
  const sources = cleanList(req.body.sources, 'sources', 100).filter(t => db.tags.includes(t));
  if (!sources.length) throw httpError(400, 'No existing tags to merge');
  const name = cleanString(req.body.target, 'target', 100);
  if (!name) throw httpError(400, 'target required');
  const target = canon(db.tags, name);
  const gone = new Set(sources.filter(t => t !== target));
  db.tags = db.tags.filter(t => !gone.has(t));
  db.entries.forEach(e => {
    if (!e.style_tags.some(t => gone.has(t))) return;
    e.style_tags = e.style_tags.filter(t => !gone.has(t));
    if (!e.style_tags.includes(target)) e.style_tags.push(target);
  });
  writeDB(db);
  res.json({ tags: db.tags });
});

router.post('/api/tags/bulk-delete', (req, res) => {
  const db = readDB();
  const gone = new Set(cleanList(req.body.names, 'names', 100));
  db.tags = db.tags.filter(t => !gone.has(t));
  db.entries.forEach(e => { e.style_tags = e.style_tags.filter(t => !gone.has(t)); });
  writeDB(db);
  res.json({ tags: db.tags });
});

module.exports = router;
