'use strict';

const express = require('express');
const compression = require('compression');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3737;

// ─── Paths ───────────────────────────────────────────────────────────────────
// Overridable so tests can point at a throwaway directory instead of the real library.
const DB_PATH = process.env.OMNIVIEW_DB_PATH || path.join(__dirname, 'db', 'library.json');
const UPLOADS_DIR = process.env.OMNIVIEW_UPLOADS_DIR || path.join(__dirname, 'uploads');
const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');
const FASHION_DB_PATH = path.join(path.dirname(DB_PATH), 'fashion.json');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');

// Ensure dirs exist
[path.dirname(DB_PATH), UPLOADS_DIR, THUMBS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const httpError = (status, message) => Object.assign(new Error(message), { status });

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

const FASHION_DB = {
  entries: [],
  boards: [],
  tags: [],
  types: ['Jacket', 'Shirt', 'Knitwear', 'Pants', 'Shoes', 'Hat', 'Bag', 'Accessory'],
  foundVia: ['Google', 'Instagram', 'Pinterest', 'Reddit', 'Referral', 'Store']
};

// Two independent libraries ("spaces"). Each is loaded once at startup and kept
// live in memory. Every route mutates and reads its space's object, so there's
// no per-request disk read (cheap) and no race between two requests reading
// stale state off disk (the thing the old read-mutate-write-per-request
// version was vulnerable to).
const SPACES = {
  ui: { file: DB_PATH, defaults: DEFAULT_DB, data: null, dirty: false },
  fashion: { file: FASHION_DB_PATH, defaults: FASHION_DB, data: null, dirty: false }
};

// The request's space. AsyncLocalStorage (not a module variable) because routes
// `await` page fetches and image work, so requests interleave.
const spaceStore = new AsyncLocalStorage();
const currentSpace = () => spaceStore.getStore() || 'ui';

// Brings entries written by older versions up to the current shape, so routes
// never have to guard against a missing array.
function normalizeEntry(e, space) {
  if (!Array.isArray(e.style_tags)) e.style_tags = [];
  if (!Array.isArray(e.boards)) e.boards = [];
  if (!Array.isArray(e.palette)) e.palette = [];
  if (!Array.isArray(e.screenshots)) e.screenshots = e.screenshot ? [e.screenshot] : []; // one-time migration
  e.screenshot = e.screenshots[0] || null; // cover image, kept for older clients and exports
  if (typeof e.title !== 'string') e.title = '';
  if (typeof e.note !== 'string') e.note = '';
  if (typeof e.found_via !== 'string') e.found_via = '';
  e.favorite = !!e.favorite;
  if (space === 'fashion') {
    if (typeof e.brand !== 'string') e.brand = '';
    if (typeof e.price !== 'string') e.price = '';
  }
}

function loadDB(space) {
  const lib = SPACES[space];
  try {
    lib.data = JSON.parse(fs.readFileSync(lib.file, 'utf8'));
  } catch (err) {
    // A missing file is a first run. A file that exists but won't parse is kept
    // aside instead of being silently overwritten by the next save.
    if (err.code !== 'ENOENT') {
      const aside = `${lib.file}.corrupt-${Date.now()}`;
      fs.renameSync(lib.file, aside);
      console.error(`${path.basename(lib.file)} was unreadable (${err.message}); moved to ${aside}`);
    }
    lib.data = JSON.parse(JSON.stringify(lib.defaults));
  }
  // Back-fill fields added after this file was first written
  if (!lib.data.types) lib.data.types = [...lib.defaults.types];
  if (!lib.data.foundVia) lib.data.foundVia = [...lib.defaults.foundVia];
  lib.data.entries.forEach(e => normalizeEntry(e, space));
}

function readDB() {
  return SPACES[currentSpace()].data;
}

// Writes are debounced: a burst of mutations (favorite toggles, bulk edits)
// costs one disk write. `flushDB` is also called on shutdown and by tests, and
// saves every space that changed.
let saveTimer = null;
let saving = Promise.resolve();

function writeDB(data) {
  const lib = SPACES[currentSpace()];
  lib.data = data;
  lib.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDB, 200);
}

// One backup per day (the state just before that day's first write); keeps the last 7.
async function backupDaily(lib) {
  const name = path.basename(lib.file, '.json');
  const dest = path.join(BACKUP_DIR, `${name}-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(lib.file) || fs.existsSync(dest)) return;
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  await fs.promises.copyFile(lib.file, dest);
  const old = (await fs.promises.readdir(BACKUP_DIR))
    .filter(f => new RegExp(`^${name}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f))
    .sort()
    .slice(0, -7);
  await Promise.all(old.map(f => fs.promises.unlink(path.join(BACKUP_DIR, f))));
}

function flushDB() {
  clearTimeout(saveTimer);
  for (const lib of Object.values(SPACES)) {
    if (!lib.dirty) continue;
    lib.dirty = false;
    const data = lib.data;
    const name = path.basename(lib.file);
    saving = saving.then(async () => {
      await backupDaily(lib);
      // Write to a temp file and rename over the original so a crash mid-write
      // can never leave the library truncated.
      const tmpPath = `${lib.file}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(data));
      await fs.promises.rename(tmpPath, lib.file);
      console.log(`[${new Date().toISOString()}] ${name} written (${data.entries.length} entries, ${data.boards.length} boards)`);
    }).catch(err => {
      lib.dirty = true;
      console.error(`Failed to write ${name}:`, err);
    });
  }
  return saving;
}

// Last-resort synchronous save for process exit, when async work can't finish.
function flushSync() {
  for (const lib of Object.values(SPACES)) {
    if (!lib.dirty) continue;
    lib.dirty = false;
    fs.writeFileSync(`${lib.file}.tmp`, JSON.stringify(lib.data));
    fs.renameSync(`${lib.file}.tmp`, lib.file);
  }
}

Object.keys(SPACES).forEach(loadDB);

// ─── Images: thumbnails + palette ────────────────────────────────────────────
// Extension is picked from the allowlisted mimetype, never the client-supplied
// filename — an .svg can carry a <script> and gets served same-origin from
// /uploads, so letting the client dictate the extension is a stored-XSS vector.
const ALLOWED_IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const MAX_SCREENSHOTS = 10;

const thumbName = file => file.replace(/\.[^.]+$/, '.webp');

function removeFiles(file) {
  fs.rmSync(path.join(UPLOADS_DIR, file), { force: true });
  fs.rmSync(path.join(THUMBS_DIR, thumbName(file)), { force: true });
}

// Up to 5 dominant colors as hex: 4-bit-per-channel histogram of a 64px
// downscale, most common buckets first, skipping near-duplicates.
async function extractPalette(src) {
  const { data } = await sharp(src).resize(64, 64, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 3) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
  }
  const picked = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const c = [b.r / b.n, b.g / b.n, b.b / b.n];
    if (picked.every(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 48)) picked.push(c);
    if (picked.length === 5) break;
  }
  return picked.map(c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
}

// Writes the ~600px WebP the grid loads instead of the full-size original, and
// returns the palette. Throws if the file isn't a decodable image.
async function processImage(file) {
  const src = path.join(UPLOADS_DIR, file);
  await sharp(src).rotate().resize({ width: 600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(THUMBS_DIR, thumbName(file)));
  return extractPalette(src);
}

// Files multer/URL-download has written but that no entry references yet; the
// orphan cleanup must not treat them as unused.
const attaching = new Set();

// Shared by file upload and "use the page's og:image": processes the already
// saved file and appends it to the entry (the first one becomes the cover).
async function attachScreenshot(entryId, file) {
  attaching.add(file);
  try {
    let palette;
    try {
      palette = await processImage(file);
    } catch {
      removeFiles(file);
      throw httpError(400, 'Could not read that image');
    }
    const entry = readDB().entries.find(e => e.id === entryId);
    if (!entry || entry.screenshots.length >= MAX_SCREENSHOTS) {
      removeFiles(file);
      throw entry ? httpError(400, `An entry can have at most ${MAX_SCREENSHOTS} screenshots`) : httpError(404, 'Entry not found');
    }
    entry.screenshots.push(file);
    entry.screenshot = entry.screenshots[0];
    if (!entry.palette.length) entry.palette = palette;
    writeDB(readDB());
    return entry;
  } finally {
    attaching.delete(file);
  }
}

// ─── Multer (screenshot uploads) ─────────────────────────────────────────────
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
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Any website you visit can make your browser call localhost. Three checks stop
// that from reaching the API: the Host header must be local (blocks DNS
// rebinding), a cross-origin Origin is refused, and every mutating request must
// carry a custom header, which browsers only allow after a CORS preflight that
// this server never approves.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ''))) return res.status(403).json({ error: 'Forbidden host' });
  const origin = req.headers.origin;
  if (origin) {
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === host; } catch { /* malformed Origin */ }
    if (!sameOrigin) return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-omniview'] !== '1') {
    return res.status(403).json({ error: 'Missing X-Omniview header' });
  }
  next();
});

// Which library an API call is about: `X-Space` header, or `?space=` for plain
// links (export downloads can't send headers). Defaults to the UI library.
app.use('/api', (req, res, next) => {
  const space = req.headers['x-space'] ?? req.query.space ?? 'ui';
  if (typeof space !== 'string' || !Object.hasOwn(SPACES, space)) return res.status(400).json({ error: 'Unknown space' });
  req.space = space;
  next();
});

app.use(compression());
app.use(express.json());
app.use((req, res, next) => { req.body ??= {}; next(); }); // Express 5 leaves body undefined when none was sent

// Runs the rest of the chain inside the request's space. It sits after the body
// parsers on purpose: they call next() from a stream event, which drops the async
// context on some Node versions if it was entered before them. multer does the
// same, so the upload route re-binds after it.
const bindSpace = (req, res, next) => spaceStore.run(req.space || 'ui', next);
app.use('/api', bindSpace);
app.use(express.static(path.join(__dirname, 'public')));
// Filenames are UUIDs and never rewritten, so browsers can cache them forever.
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '365d', immutable: true }));

// ─── Validation ───────────────────────────────────────────────────────────────
function cleanString(v, field, max) {
  if (typeof v !== 'string') throw httpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length > max) throw httpError(400, `${field} is too long (max ${max})`);
  return s;
}

function cleanList(v, field, maxItem) {
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) throw httpError(400, `${field} must be an array of strings`);
  const list = [...new Set(v.map(s => s.trim()).filter(Boolean))];
  if (list.length > 200 || list.some(s => s.length > maxItem)) throw httpError(400, `${field} has too many or too long items`);
  return list;
}

// Only http(s) is accepted: the value ends up in <a href>, so `javascript:` must never be stored.
function cleanHttpUrl(v, field) {
  const s = cleanString(v, field, 2048);
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return s;
  } catch { /* fall through */ }
  throw httpError(400, `${field} must be an http(s) URL`);
}

// Case-insensitive lookup in a managed list; unknown names are registered, so
// filters and the Settings lists never disagree with what entries contain.
function canon(list, name) {
  const hit = list.find(o => o.toLowerCase() === name.toLowerCase());
  if (hit) return hit;
  list.push(name);
  return name;
}

const optional = v => (v == null || v === '' ? null : v);

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
  if (currentSpace() === 'fashion') {
    if (has('price')) out.price = cleanString(body.price, 'price', 50);
    if (has('brand')) out.brand = cleanString(body.brand, 'brand', 100);
  }
  if (has('favorite')) {
    if (typeof body.favorite !== 'boolean') throw httpError(400, 'favorite must be a boolean');
    out.favorite = body.favorite;
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
// slash, the #fragment, parameter order, or tracking parameters.
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|igshid|mc_cid|mc_eid|ref|ref_src|_hsenc|_hsmi)$/i;

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = new URLSearchParams(params).toString();
    return `${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}`;
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
app.get('/api/entries', (req, res) => {
  res.json([...readDB().entries].sort((a, b) => new Date(b.date_added) - new Date(a.date_added)));
});

// Is this URL already saved? Used by the add form as you type.
app.get('/api/duplicate', (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  res.json({ duplicate: url ? findDuplicate(readDB(), url, req.query.exclude) : null });
});

// Get single entry
app.get('/api/entries/:id', (req, res) => {
  const entry = readDB().entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

// Create entry. An already-saved URL is refused with 409 unless `force` is set.
app.post('/api/entries', (req, res) => {
  const db = readDB();
  const fields = cleanEntryFields(req.body, db, true);
  const existing = findDuplicate(db, fields.url);
  if (existing && req.body.force !== true) {
    return res.status(409).json({ error: 'That URL is already saved', duplicate: existing });
  }

  const entry = {
    id: uuidv4(),
    title: '',
    screenshot: null,
    screenshots: [],
    palette: [],
    type: null,
    color: null,
    style_tags: [],
    note: '',
    found_via: '',
    favicon: null,
    favorite: false,
    boards: [],
    date_added: new Date().toISOString(),
    ...(currentSpace() === 'fashion' && { brand: '', price: '' }),
    ...fields
  };

  db.entries.push(entry);
  writeDB(db);
  res.status(201).json({ entry, isDuplicate: !!existing });
});

// Update entry
app.put('/api/entries/:id', (req, res) => {
  const db = readDB();
  const entry = db.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  const fields = cleanEntryFields(req.body, db, false);
  if (req.body.removeScreenshot) {
    entry.screenshots.forEach(removeFiles);
    entry.screenshots = [];
    entry.screenshot = null;
    entry.palette = [];
  }
  Object.assign(entry, fields);
  writeDB(db);
  res.json(entry);
});

// Add a screenshot (the first one becomes the cover)
app.post('/api/entries/:id/screenshot', upload.single('screenshot'), bindSpace, async (req, res) => {
  if (!req.file) throw httpError(400, 'No file uploaded');
  const entry = await attachScreenshot(req.params.id, req.file.filename);
  res.json({ screenshot: req.file.filename, screenshots: entry.screenshots });
});

// Remove one screenshot; the palette follows whichever image is now the cover.
app.delete('/api/entries/:id/screenshots/:file', async (req, res) => {
  const entry = readDB().entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const i = entry.screenshots.indexOf(req.params.file);
  if (i === -1) return res.status(404).json({ error: 'Screenshot not found' });
  entry.screenshots.splice(i, 1);
  removeFiles(req.params.file);
  entry.screenshot = entry.screenshots[0] || null;
  if (i === 0) {
    entry.palette = entry.screenshot ? await extractPalette(path.join(UPLOADS_DIR, entry.screenshot)).catch(() => []) : [];
  }
  writeDB(readDB());
  res.json(entry);
});

// Delete entry
app.delete('/api/entries/:id', (req, res) => {
  const db = readDB();
  const idx = db.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [entry] = db.entries.splice(idx, 1);
  entry.screenshots.forEach(removeFiles);
  writeDB(db);
  res.json({ ok: true });
});

// Bulk actions
app.post('/api/entries/bulk', (req, res) => {
  const { ids, action } = req.body;
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw httpError(400, 'ids array required');
  const db = readDB();

  const boardIds = () => {
    const wanted = cleanList([].concat(req.body.boards ?? []), 'boards', 100);
    return wanted.filter(id => db.boards.some(b => b.id === id));
  };
  // Resolve and validate the action's argument once, before touching any entry.
  let apply;
  switch (action) {
    case 'delete':
      apply = e => { db.entries.splice(db.entries.indexOf(e), 1); e.screenshots.forEach(removeFiles); };
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
      const value = req.body.value !== false;
      apply = e => { e.favorite = value; };
      break;
    }
    default:
      throw httpError(400, 'Unknown bulk action');
  }

  const wanted = new Set(ids);
  db.entries.filter(e => wanted.has(e.id)).forEach(apply);
  writeDB(db);
  res.json({ ok: true });
});

// ─── Page info (auto-fill from URL) ───────────────────────────────────────────
// Fetches with a timeout and a size cap. `truncate` keeps what was read when the
// cap is hit (fine for HTML, where <head> comes first); otherwise it's an error.
async function fetchCapped(url, { maxBytes, truncate }) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Omniview/1.0)' }
  });
  if (!res.ok) throw httpError(502, `The site answered ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) {
      if (truncate) break;
      throw httpError(502, 'That file is too large');
    }
    chunks.push(chunk);
  }
  return { type, buffer: Buffer.concat(chunks), finalUrl: res.url };
}

const decodeEntities = s => s
  .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3]);
  return out;
}

// The first schema.org Product (or ProductGroup) in the page's JSON-LD, if any.
// Scans the whole document: shop pages often put it far past the <head>.
function productNode(html) {
  let found = null;
  const walk = n => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if ([].concat(n['@type'] || []).some(t => /^Product(Group)?$/.test(t))) { found = n; return; }
    walk(n['@graph']);
  };
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* malformed JSON-LD is common; skip it */ }
    if (found) break;
  }
  return found;
}

function pageInfo(html, baseUrl) {
  const meta = {};
  const ogImages = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(tag);
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content.trim();
    if (/^(og|twitter):image(:url)?$/.test(key) && a.content) ogImages.push(a.content.trim());
  }
  const abs = href => {
    try {
      const u = new URL(href, baseUrl);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch { return null; }
  };
  let favicon = null;
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(tag);
    if (a.href && /\bicon\b/i.test(a.rel || '')) { favicon = abs(a.href); break; }
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const theme = (meta['theme-color'] || '').match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

  const product = productNode(html) || {};
  const text = v => (typeof v === 'string' ? v : v && typeof v.name === 'string' ? v.name : '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const first = v => [].concat(v ?? [])[0];
  const offer = first(product.offers) || first(first(product.hasVariant)?.offers) || {};
  const rawPrice = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price ?? meta['og:price:amount'] ?? meta['product:price:amount'];
  const price = Number(rawPrice);
  // JSON-LD image URLs are sloppy ("https:files/x.jpg"); only take ones that are clearly URLs.
  const ldImages = [].concat(product.image ?? []).map(i => (typeof i === 'string' ? i : i?.url)).filter(i => /^(https?:)?\/\//.test(i) || /^\/[^/]/.test(i));
  // Same picture often appears as http/https or with different ?v= params; keep the first.
  const seen = new Set();
  const images = [...ogImages, ...ldImages].map(abs).filter(u => {
    const key = u && u.replace(/^https?:/, '').split('?')[0];
    return key && !seen.has(key) && seen.add(key);
  }).slice(0, 8);

  return {
    title: (meta['og:title'] || meta['twitter:title'] || (titleTag ? decodeEntities(titleTag[1]) : '')).replace(/\s+/g, ' ').trim().slice(0, 300),
    image: images[0] || null,
    images,
    favicon: favicon || abs('/favicon.ico'),
    themeColor: theme ? '#' + (theme[1].length === 3 ? [...theme[1]].map(c => c + c).join('') : theme[1]).toLowerCase() : null,
    brand: text(product.brand) || null,
    siteName: text(meta['og:site_name']) || null,
    price: rawPrice !== '' && rawPrice != null && Number.isFinite(price) && price > 0 ? String(+price.toFixed(2)) : null,
    currency: text(offer.priceCurrency || meta['og:price:currency'] || meta['product:price:currency']) || null,
    color: text(product.color) || null,
    category: text(product.category) || null
  };
}

app.get('/api/unfurl', async (req, res) => {
  const url = cleanHttpUrl(typeof req.query.url === 'string' ? req.query.url : '', 'url');
  let page;
  try {
    page = await fetchCapped(url, { maxBytes: 4 * 1024 * 1024, truncate: true });
  } catch (err) {
    throw err.status ? err : httpError(502, 'Could not reach that site');
  }
  if (!/html/.test(page.type)) throw httpError(502, 'That URL is not a web page');
  res.json(pageInfo(page.buffer.toString('utf8'), page.finalUrl));
});

// Downloads an image from a URL (e.g. the page's og:image) and attaches it like an upload.
app.post('/api/entries/:id/screenshot-url', async (req, res) => {
  const url = cleanHttpUrl(req.body.url, 'url');
  let img;
  try {
    img = await fetchCapped(url, { maxBytes: 15 * 1024 * 1024, truncate: false });
  } catch (err) {
    throw err.status ? err : httpError(502, 'Could not download that image');
  }
  const ext = ALLOWED_IMAGE_TYPES[img.type];
  if (!ext) throw httpError(400, 'Only PNG, JPEG, WEBP, or GIF images are allowed');
  const file = `${uuidv4()}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), img.buffer);
  const entry = await attachScreenshot(req.params.id, file);
  res.json({ screenshot: file, screenshots: entry.screenshots });
});

// ─── Boards ───────────────────────────────────────────────────────────────────
app.get('/api/boards', (req, res) => {
  const db = readDB();
  const counts = {};
  db.entries.forEach(e => e.boards.forEach(b => { counts[b] = (counts[b] || 0) + 1; }));
  res.json(db.boards.map(b => ({ ...b, count: counts[b.id] || 0 })));
});

app.post('/api/boards', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name required' });
  if (name.length > 100) return res.status(400).json({ error: 'name is too long' });
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
  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
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
    e.boards = e.boards.filter(bid => bid !== req.params.id);
  });
  writeDB(db);
  res.json({ ok: true });
});

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

// Merge several tags into one (an existing tag, or a new name).
app.post('/api/tags/merge', (req, res) => {
  const db = readDB();
  const sources = cleanList(req.body.sources, 'sources', 100).filter(t => db.tags.includes(t));
  if (!sources.length) throw httpError(400, 'No existing tags to merge');
  const target = canon(db.tags, cleanString(req.body.target, 'target', 100));
  if (!target) throw httpError(400, 'target required');
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

app.post('/api/tags/bulk-delete', (req, res) => {
  const db = readDB();
  const gone = new Set(cleanList(req.body.names, 'names', 100));
  db.tags = db.tags.filter(t => !gone.has(t));
  db.entries.forEach(e => { e.style_tags = e.style_tags.filter(t => !gone.has(t)); });
  writeDB(db);
  res.json({ tags: db.tags });
});

app.put('/api/tags/:name', (req, res) => {
  const db = readDB();
  const oldName = req.params.name;
  const idx = db.tags.findIndex(t => t === oldName);
  if (idx === -1) return res.status(404).json({ error: 'Tag not found' });
  const v = validateOptionName(req.body.newName, db.tags, oldName);
  if (v.error) return res.status(v.status).json({ error: v.error });
  db.tags[idx] = v.value;
  // Update in all entries
  db.entries.forEach(e => {
    e.style_tags = e.style_tags.map(t => t === oldName ? v.value : t);
  });
  writeDB(db);
  res.json({ tags: db.tags });
});

app.delete('/api/tags/:name', (req, res) => {
  const db = readDB();
  const name = req.params.name;
  db.tags = db.tags.filter(t => t !== name);
  // Remove from all entries
  db.entries.forEach(e => {
    e.style_tags = e.style_tags.filter(t => t !== name);
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
  const oldName = req.params.name;
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
  const name = req.params.name;
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
  const oldName = req.params.name;
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
  const name = req.params.name;
  db.foundVia = db.foundVia.filter(t => t !== name);
  db.entries.forEach(e => { if (e.found_via === name) e.found_via = ''; });
  writeDB(db);
  res.json({ foundVia: db.foundVia });
});

// ─── Export ───────────────────────────────────────────────────────────────────
app.get('/api/export', (req, res) => {
  const db = readDB();
  const fmt = req.query.format || 'json';
  const space = currentSpace();
  const base = space === 'ui' ? 'omniview-export' : `omniview-${space}-export`;

  if (fmt === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
    res.json(db);
  } else {
    // ZIP with JSON + screenshots
    res.setHeader('Content-Disposition', `attachment; filename="${base}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    const archive = archiver('zip');
    archive.pipe(res);
    archive.append(JSON.stringify(db, null, 2), { name: path.basename(SPACES[space].file) });
    // Add screenshot files
    db.entries.forEach(e => e.screenshots.forEach(file => {
      const p = path.join(UPLOADS_DIR, file);
      if (fs.existsSync(p)) archive.file(p, { name: `uploads/${file}` });
    }));
    archive.finalize();
  }
});

// ─── Maintenance ──────────────────────────────────────────────────────────────
// Deletes upload files (and thumbnails) that no entry references, e.g. left
// behind when an upload succeeded but the entry was never saved.
app.post('/api/cleanup', (req, res) => {
  const used = new Set(attaching);
  // Uploads are shared by every space, so a file is unused only if no space's entries reference it.
  Object.values(SPACES).forEach(lib => lib.data.entries.forEach(e => e.screenshots.forEach(f => used.add(f))));
  let removed = 0;
  let bytes = 0;
  const sweep = (dir, isUsed) => fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && !isUsed(d.name))
    .forEach(d => {
      const p = path.join(dir, d.name);
      bytes += fs.statSync(p).size;
      fs.rmSync(p);
      removed++;
    });
  sweep(UPLOADS_DIR, name => used.has(name));
  const usedThumbs = new Set([...used].map(thumbName));
  sweep(THUMBS_DIR, name => usedThumbs.has(name));
  res.json({ removed, bytes });
});

// ─── Reset ────────────────────────────────────────────────────────────────────
app.post('/api/reset', (req, res) => {
  if (req.body.confirm !== 'reset') throw httpError(400, 'Send {"confirm":"reset"} to wipe this library');
  const db = readDB();
  db.entries.forEach(e => e.screenshots.forEach(removeFiles));
  writeDB(JSON.parse(JSON.stringify(SPACES[currentSpace()].defaults)));
  res.json({ ok: true });
});

// ─── Error handling ───────────────────────────────────────────────────────────
// Catches thrown errors from route handlers (sync or async — Express 5 forwards
// both) and multer's fileFilter/limits errors, so a bad request gets a clean
// JSON response instead of Express's default HTML stack trace.
app.use((err, req, res, next) => {
  if (err.message === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(400).json({ error: 'Only PNG, JPEG, WEBP, or GIF images are allowed' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} error:`, err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
});

// Generates thumbnails/palettes for screenshots saved before those existed.
async function backfillImages() {
  for (const space of Object.keys(SPACES)) await spaceStore.run(space, backfillSpace);
}

async function backfillSpace() {
  let changed = false;
  for (const e of readDB().entries) {
    for (const file of e.screenshots) {
      if (!fs.existsSync(path.join(UPLOADS_DIR, file))) continue;
      const hasThumb = fs.existsSync(path.join(THUMBS_DIR, thumbName(file)));
      if (hasThumb && (file !== e.screenshots[0] || e.palette.length)) continue;
      try {
        const palette = await processImage(file);
        if (file === e.screenshots[0] && !e.palette.length) { e.palette = palette; changed = true; }
      } catch (err) {
        console.error(`Could not process ${file}:`, err.message);
      }
    }
  }
  if (changed) writeDB(readDB());
}

// ─── Start ────────────────────────────────────────────────────────────────────
module.exports = app;
app.flushDB = flushDB;

if (require.main === module) {
  // A fatal error leaves the process in an unknown state: log it and exit
  // rather than carry on (the pending save is flushed by the exit handler).
  process.on('uncaughtException', err => { console.error('Uncaught exception:', err); process.exit(1); });
  process.on('unhandledRejection', err => { console.error('Unhandled rejection:', err); process.exit(1); });
  process.on('exit', flushSync);
  ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, async () => { await flushDB(); process.exit(0); }));

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🎨 Omniview running at http://localhost:${PORT}\n`);
    backfillImages();
  });
}
