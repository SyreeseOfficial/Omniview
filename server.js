'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3737;

// ─── Paths ───────────────────────────────────────────────────────────────────
// Overridable so tests can point at a throwaway directory instead of the real library.
const DB_PATH = process.env.OMNIVIEW_DB_PATH || path.join(__dirname, 'db', 'library.json');
const UPLOADS_DIR = process.env.OMNIVIEW_UPLOADS_DIR || path.join(__dirname, 'uploads');

// Ensure dirs exist
[path.dirname(DB_PATH), UPLOADS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── JSON "Database" ─────────────────────────────────────────────────────────
const DEFAULT_DB = {
  entries: [],
  boards: [],
  tags: [
    'Minimal', 'Brutalist', 'Dark Mode', 'Light Mode', 'Glassmorphism',
    'Neumorphism', 'Flat', 'Material', 'Gradient', 'Monochrome',
    'Typographic', 'Editorial', 'Playful', 'Corporate', 'Retro',
    'Futuristic', 'Hand-drawn', 'Geometric', 'Organic', 'Bold',
    'Clean', 'Dense', 'Spacious', 'Colorful', 'Muted', 'Illustrated'
  ],
  types: ['Website', 'Web App'],
  foundVia: ['Dribbble', 'Google', 'Instagram', 'Newsletter', 'Pinterest', 'Referral', 'Twitter/X']
};

// Loaded once at startup and kept live in memory. Every route mutates and
// reads this same object, so there's no per-request disk read (cheap) and no
// race between two requests reading stale state off disk (the thing the old
// read-mutate-write-per-request version was vulnerable to).
let cache = null;

function loadDB() {
  try {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    cache = JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  // Back-fill fields added after this file was first written
  if (!cache.types) cache.types = [...DEFAULT_DB.types];
  if (!cache.foundVia) cache.foundVia = [...DEFAULT_DB.foundVia];
}

function readDB() {
  return cache;
}

function writeDB(data) {
  cache = data;
  const json = JSON.stringify(data, null, 2);
  // Keep a rolling backup of the last-known-good file before overwriting it.
  if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, `${DB_PATH}.bak`);
  // Write to a temp file and rename over the original so a crash mid-write
  // can never leave library.json truncated.
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, json);
  fs.renameSync(tmpPath, DB_PATH);
  console.log(`[${new Date().toISOString()}] library.json written (${data.entries.length} entries, ${data.boards.length} boards)`);
}

loadDB();

// ─── Multer (screenshot uploads) ─────────────────────────────────────────────
// Extension is picked from the allowlisted mimetype, never the client-supplied
// filename — an .svg can carry a <script> and gets served same-origin from
// /uploads, so letting the client dictate the extension is a stored-XSS vector.
const ALLOWED_IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${ALLOWED_IMAGE_TYPES[file.mimetype]}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) return cb(new Error('UNSUPPORTED_FILE_TYPE'));
    cb(null, true);
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Entries ──────────────────────────────────────────────────────────────────

// List entries (with filter/search)
app.get('/api/entries', (req, res) => {
  const db = readDB();
  let entries = db.entries;
  const { q, type, tags, board, favorite, tagMode } = req.query;

  if (q) {
    const lower = q.toLowerCase();
    entries = entries.filter(e =>
      (e.title || '').toLowerCase().includes(lower) ||
      e.url.toLowerCase().includes(lower) ||
      (e.note || '').toLowerCase().includes(lower) ||
      (e.style_tags || []).some(t => t.toLowerCase().includes(lower))
    );
  }
  if (type) {
    entries = entries.filter(e => e.type === type);
  }
  if (tags) {
    const selected = Array.isArray(tags) ? tags : [tags];
    if (tagMode === 'all') {
      entries = entries.filter(e => selected.every(t => (e.style_tags || []).includes(t)));
    } else {
      entries = entries.filter(e => selected.some(t => (e.style_tags || []).includes(t)));
    }
  }
  if (board) {
    entries = entries.filter(e => (e.boards || []).includes(board));
  }
  if (favorite === 'true') {
    entries = entries.filter(e => e.favorite);
  }

  // Default sort: newest first
  entries = [...entries].sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  res.json(entries);
});

// Get single entry
app.get('/api/entries/:id', (req, res) => {
  const db = readDB();
  const entry = db.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

// Create entry
app.post('/api/entries', (req, res) => {
  const db = readDB();
  const { url, title, type, color, style_tags, note, found_via, favorite, boards } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const existing = db.entries.find(e => e.url === url);
  const isDuplicate = !!existing;

  const entry = {
    id: uuidv4(),
    url,
    title: title || '',
    screenshot: null,
    type: type || null,
    color: color || null,
    style_tags: style_tags || [],
    note: note || '',
    found_via: found_via || '',
    favorite: favorite || false,
    boards: boards || [],
    date_added: new Date().toISOString()
  };

  db.entries.push(entry);
  writeDB(db);
  res.status(201).json({ entry, isDuplicate });
});

// Update entry
app.put('/api/entries/:id', (req, res) => {
  const db = readDB();
  const idx = db.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  if (req.body.removeScreenshot && db.entries[idx].screenshot) {
    const p = path.join(UPLOADS_DIR, db.entries[idx].screenshot);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    db.entries[idx].screenshot = null;
  }

  const allowed = ['url', 'title', 'type', 'color', 'style_tags', 'note', 'found_via', 'favorite', 'boards'];
  allowed.forEach(k => {
    if (req.body[k] !== undefined) db.entries[idx][k] = req.body[k];
  });
  writeDB(db);
  res.json(db.entries[idx]);
});

// Upload / replace screenshot
app.post('/api/entries/:id/screenshot', upload.single('screenshot'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const db = readDB();
  const idx = db.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Entry not found' });
  }
  // Remove old screenshot if exists
  if (db.entries[idx].screenshot) {
    const old = path.join(UPLOADS_DIR, db.entries[idx].screenshot);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  db.entries[idx].screenshot = req.file.filename;
  writeDB(db);
  res.json({ screenshot: req.file.filename });
});

// Delete entry
app.delete('/api/entries/:id', (req, res) => {
  const db = readDB();
  const idx = db.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [entry] = db.entries.splice(idx, 1);
  if (entry.screenshot) {
    const p = path.join(UPLOADS_DIR, entry.screenshot);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  writeDB(db);
  res.json({ ok: true });
});

// Bulk actions
app.post('/api/entries/bulk', (req, res) => {
  const { ids, action, tag, boards } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const db = readDB();

  ids.forEach(id => {
    const idx = db.entries.findIndex(e => e.id === id);
    if (idx === -1) return;
    if (action === 'delete') {
      const [entry] = db.entries.splice(idx, 1);
      if (entry.screenshot) {
        const p = path.join(UPLOADS_DIR, entry.screenshot);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } else if (action === 'tag' && tag) {
      if (!db.entries[idx].style_tags.includes(tag)) {
        db.entries[idx].style_tags.push(tag);
      }
    } else if (action === 'addToBoard' && boards) {
      const toAdd = Array.isArray(boards) ? boards : [boards];
      toAdd.forEach(b => {
        if (!db.entries[idx].boards.includes(b)) db.entries[idx].boards.push(b);
      });
    }
  });

  writeDB(db);
  res.json({ ok: true });
});

// ─── Boards ───────────────────────────────────────────────────────────────────
app.get('/api/boards', (req, res) => {
  const db = readDB();
  // Attach entry count
  const boards = db.boards.map(b => ({
    ...b,
    count: db.entries.filter(e => (e.boards || []).includes(b.id)).length
  }));
  res.json(boards);
});

app.post('/api/boards', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = readDB();
  const board = { id: uuidv4(), name, created: new Date().toISOString() };
  db.boards.push(board);
  writeDB(db);
  res.status(201).json(board);
});

app.put('/api/boards/:id', (req, res) => {
  const db = readDB();
  const idx = db.boards.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const name = (req.body.name || '').trim();
  if (name) db.boards[idx].name = name;
  writeDB(db);
  res.json(db.boards[idx]);
});

app.delete('/api/boards/:id', (req, res) => {
  const db = readDB();
  const idx = db.boards.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.boards.splice(idx, 1);
  // Remove board from all entries
  db.entries.forEach(e => {
    e.boards = (e.boards || []).filter(bid => bid !== req.params.id);
  });
  writeDB(db);
  res.json({ ok: true });
});

// Shared by tags/types/found-via create + rename: trims, rejects blank, and
// rejects a case-insensitive collision with an existing option. `self` is the
// option's own current name (excluded from the collision check) when renaming.
function validateOptionName(name, list, self) {
  const trimmed = (name || '').trim();
  if (!trimmed) return { error: 'name required', status: 400 };
  const dupe = list.some(o => o.toLowerCase() === trimmed.toLowerCase() && o !== self);
  if (dupe) return { error: 'That name already exists', status: 409 };
  return { value: trimmed };
}

// ─── Tags ─────────────────────────────────────────────────────────────────────
app.get('/api/tags', (req, res) => {
  res.json(readDB().tags);
});

app.post('/api/tags', (req, res) => {
  const db = readDB();
  const v = validateOptionName(req.body.name, db.tags);
  if (v.error) return res.status(v.status).json({ error: v.error });
  db.tags.push(v.value);
  writeDB(db);
  res.status(201).json({ tags: db.tags });
});

app.put('/api/tags/:name', (req, res) => {
  const db = readDB();
  const oldName = decodeURIComponent(req.params.name);
  const idx = db.tags.findIndex(t => t === oldName);
  if (idx === -1) return res.status(404).json({ error: 'Tag not found' });
  const v = validateOptionName(req.body.newName, db.tags, oldName);
  if (v.error) return res.status(v.status).json({ error: v.error });
  db.tags[idx] = v.value;
  // Update in all entries
  db.entries.forEach(e => {
    e.style_tags = (e.style_tags || []).map(t => t === oldName ? v.value : t);
  });
  writeDB(db);
  res.json({ tags: db.tags });
});

app.delete('/api/tags/:name', (req, res) => {
  const db = readDB();
  const name = decodeURIComponent(req.params.name);
  db.tags = db.tags.filter(t => t !== name);
  // Remove from all entries
  db.entries.forEach(e => {
    e.style_tags = (e.style_tags || []).filter(t => t !== name);
  });
  writeDB(db);
  res.json({ tags: db.tags });
});

// ─── Types ────────────────────────────────────────────────────────────────────
app.get('/api/types', (req, res) => {
  res.json(readDB().types);
});

app.post('/api/types', (req, res) => {
  const db = readDB();
  const v = validateOptionName(req.body.name, db.types);
  if (v.error) return res.status(v.status).json({ error: v.error });
  db.types.push(v.value);
  writeDB(db);
  res.status(201).json({ types: db.types });
});

app.put('/api/types/:name', (req, res) => {
  const db = readDB();
  const oldName = decodeURIComponent(req.params.name);
  const idx = db.types.findIndex(t => t === oldName);
  if (idx === -1) return res.status(404).json({ error: 'Type not found' });
  const v = validateOptionName(req.body.newName, db.types, oldName);
  if (v.error) return res.status(v.status).json({ error: v.error });
  db.types[idx] = v.value;
  db.entries.forEach(e => { if (e.type === oldName) e.type = v.value; });
  writeDB(db);
  res.json({ types: db.types });
});

app.delete('/api/types/:name', (req, res) => {
  const db = readDB();
  const name = decodeURIComponent(req.params.name);
  db.types = db.types.filter(t => t !== name);
  // Clear it from any entry still using it
  db.entries.forEach(e => { if (e.type === name) e.type = null; });
  writeDB(db);
  res.json({ types: db.types });
});

// ─── Found Via ────────────────────────────────────────────────────────────────
app.get('/api/found-via', (req, res) => {
  res.json(readDB().foundVia);
});

app.post('/api/found-via', (req, res) => {
  const db = readDB();
  const v = validateOptionName(req.body.name, db.foundVia);
  if (v.error) return res.status(v.status).json({ error: v.error });
  db.foundVia.push(v.value);
  writeDB(db);
  res.status(201).json({ foundVia: db.foundVia });
});

app.put('/api/found-via/:name', (req, res) => {
  const db = readDB();
  const oldName = decodeURIComponent(req.params.name);
  const idx = db.foundVia.findIndex(t => t === oldName);
  if (idx === -1) return res.status(404).json({ error: 'Found via option not found' });
  const v = validateOptionName(req.body.newName, db.foundVia, oldName);
  if (v.error) return res.status(v.status).json({ error: v.error });
  db.foundVia[idx] = v.value;
  db.entries.forEach(e => { if (e.found_via === oldName) e.found_via = v.value; });
  writeDB(db);
  res.json({ foundVia: db.foundVia });
});

app.delete('/api/found-via/:name', (req, res) => {
  const db = readDB();
  const name = decodeURIComponent(req.params.name);
  db.foundVia = db.foundVia.filter(t => t !== name);
  db.entries.forEach(e => { if (e.found_via === name) e.found_via = ''; });
  writeDB(db);
  res.json({ foundVia: db.foundVia });
});

// ─── Export ───────────────────────────────────────────────────────────────────
app.get('/api/export', (req, res) => {
  const db = readDB();
  const fmt = req.query.format || 'json';

  if (fmt === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="omniview-export.json"');
    res.json(db);
  } else {
    // ZIP with JSON + screenshots
    res.setHeader('Content-Disposition', 'attachment; filename="omniview-export.zip"');
    res.setHeader('Content-Type', 'application/zip');
    const archive = archiver('zip');
    archive.pipe(res);
    archive.append(JSON.stringify(db, null, 2), { name: 'library.json' });
    // Add screenshot files
    db.entries.forEach(e => {
      if (e.screenshot) {
        const p = path.join(UPLOADS_DIR, e.screenshot);
        if (fs.existsSync(p)) archive.file(p, { name: `uploads/${e.screenshot}` });
      }
    });
    archive.finalize();
  }
});

// ─── Reset ────────────────────────────────────────────────────────────────────
app.post('/api/reset', (req, res) => {
  // Delete all screenshots
  const db = readDB();
  db.entries.forEach(e => {
    if (e.screenshot) {
      const p = path.join(UPLOADS_DIR, e.screenshot);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });
  writeDB(JSON.parse(JSON.stringify(DEFAULT_DB)));
  res.json({ ok: true });
});

// ─── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const db = readDB();
  res.json({
    entries: db.entries.length,
    boards: db.boards.length,
    tags: db.tags.length,
    favorites: db.entries.filter(e => e.favorite).length,
    withScreenshots: db.entries.filter(e => e.screenshot).length
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────
// Catches both thrown errors from route handlers (Express 4 routes these here
// automatically) and multer's fileFilter/limits errors, so a bad request gets
// a clean JSON response instead of Express's default HTML stack trace.
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} error:`, err);
  if (err.message === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(400).json({ error: 'Only PNG, JPEG, WEBP, or GIF images are allowed' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

process.on('uncaughtException', err => console.error('Uncaught exception:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

// ─── Start ────────────────────────────────────────────────────────────────────
module.exports = app;

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🎨 Omniview running at http://localhost:${PORT}\n`);
  });
}
