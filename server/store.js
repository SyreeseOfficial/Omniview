'use strict';

// The libraries ("spaces"): paths, in-memory data, debounced saving, backups, the trash.
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

// ─── Paths ───────────────────────────────────────────────────────────────────
// Overridable so tests can point at a throwaway directory instead of the real library.
const DB_PATH = process.env.OMNIVIEW_DB_PATH || path.join(__dirname, 'db', 'library.json');
const UPLOADS_DIR = process.env.OMNIVIEW_UPLOADS_DIR || path.join(__dirname, 'uploads');
const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');
const FASHION_DB_PATH = path.join(path.dirname(DB_PATH), 'fashion.json');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const LOCK_PATH = path.join(path.dirname(DB_PATH), '.lock');

// Ensure dirs exist
[path.dirname(DB_PATH), UPLOADS_DIR, THUMBS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));


// ─── JSON "Database" ─────────────────────────────────────────────────────────
const DEFAULT_DB = {
  entries: [],
  trash: [], // deleted entries, kept TRASH_DAYS before the purge
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
  trash: [],
  boards: [],
  tags: [],
  types: ['Jacket', 'Shirt', 'Knitwear', 'Pants', 'Shoes', 'Hat', 'Bag', 'Accessory'],
  foundVia: ['Google', 'Instagram', 'Pinterest', 'Reddit', 'Referral', 'Store']
};

// Independent libraries ("spaces"). A new one is a new entry here (plus nothing else):
//   label    shown in the space switcher
//   file     where it is saved
//   defaults the starting tags / types / found-via lists
//   fields   extra string fields on each entry, as { name: maxLength }
//   features parts of the UI this library does without (all on unless false)
// Each is loaded once at startup and kept live in memory. Every route mutates and reads its space's object, so there's
// no per-request disk read (cheap) and no race between two requests reading
// stale state off disk (the thing the old read-mutate-write-per-request
// version was vulnerable to).
const SPACES = {
  ui: { label: 'UI', file: DB_PATH, defaults: DEFAULT_DB, fields: {}, features: {} },
  fashion: { label: 'Fashion', file: FASHION_DB_PATH, defaults: FASHION_DB, fields: { brand: 100, price: 50, price_was: 50 }, features: { foundVia: false } }
};
Object.values(SPACES).forEach(lib => Object.assign(lib, { data: null, dirty: false }));

// The request's space. AsyncLocalStorage (not a module variable) because routes
// `await` page fetches and image work, so requests interleave.
const spaceStore = new AsyncLocalStorage();
const currentSpace = () => spaceStore.getStore() || 'ui';

// Brings entries written by older versions up to the current shape, so routes
// never have to guard against a missing array.
const validDate = d => typeof d === 'string' && !Number.isNaN(Date.parse(d));

function normalizeEntry(e, space) {
  if (!Array.isArray(e.style_tags)) e.style_tags = [];
  if (!Array.isArray(e.boards)) e.boards = [];
  if (!Array.isArray(e.palette)) e.palette = [];
  if (!Array.isArray(e.remote_shots)) e.remote_shots = []; // screenshots fetched from a page URL (og:image stand-ins)
  if (!Array.isArray(e.screenshots)) e.screenshots = e.screenshot ? [e.screenshot] : []; // one-time migration
  delete e.screenshot; // the cover is screenshots[0]
  delete e.pinned; // removed feature
  if (!e.image_hashes || typeof e.image_hashes !== 'object' || Array.isArray(e.image_hashes)) e.image_hashes = {}; // sha256 per file, for duplicate detection
  if (typeof e.title !== 'string') e.title = '';
  if (typeof e.note !== 'string') e.note = '';
  if (typeof e.found_via !== 'string') e.found_via = '';
  e.favorite = !!e.favorite;
  e.bought = !!e.bought;
  if (typeof e.visited_at !== 'string') e.visited_at = null;
  if (!validDate(e.date_added)) e.date_added = validDate(e.updated_at) ? e.updated_at : new Date().toISOString(); // reported by libraryProblems first
  for (const f of Object.keys(SPACES[space].fields)) if (typeof e[f] !== 'string') e[f] = '';
}

// Specific problems in a loaded library, as readable lines. Only reported, never
// fixed: a hand-edited or half-restored file is better flagged than silently rewritten
// (a bad date_added is the one exception, see normalizeEntry).
function libraryProblems(data) {
  const problems = [];
  const trash = data.trash ?? [];
  for (const [kind, list] of [['entry', data.entries], ['trashed entry', trash], ['board', data.boards]]) {
    const seen = new Set();
    list.forEach((x, i) => {
      const label = x.title || x.name || x.url || '';
      if (typeof x.id !== 'string' || !x.id) problems.push(`${kind} #${i + 1} ("${label}") has no id`);
      else if (seen.has(x.id)) problems.push(`duplicate ${kind} id ${x.id} ("${label}")`);
      else seen.add(x.id);
    });
  }
  const boardIds = new Set(data.boards.map(b => b.id));
  for (const e of [...data.entries, ...trash]) {
    for (const b of e.boards ?? []) if (!boardIds.has(b)) problems.push(`entry ${e.id} ("${e.title || e.url}") is on missing board ${b}`);
    if (!validDate(e.date_added)) problems.push(`entry ${e.id} ("${e.title || e.url}") has an invalid date_added: ${JSON.stringify(e.date_added)}`);
  }
  return problems;
}

// Screenshot files that entries point at but that are not in uploads/ (usually an old JSON backup restored without its files).
function brokenImages(data) {
  const broken = [];
  for (const e of [...data.entries, ...data.trash]) {
    for (const f of e.screenshots) if (!fs.existsSync(path.join(UPLOADS_DIR, f))) broken.push({ id: e.id, file: f });
  }
  return broken;
}

const isList = l => Array.isArray(l) && l.every(x => x && typeof x === 'object');

// Parses and checks a library file; throws if it cannot be used.
function readLibraryFile(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isList(data.entries) || !isList(data.boards) || !isList(data.trash ?? [])) throw new Error('entries, boards and trash must be lists of objects');
  return data;
}

// The newest daily backup of a library that still parses, or null.
function newestBackup(lib) {
  const name = path.basename(lib.file, '.json');
  const re = new RegExp(`^${name}-\\d{4}-\\d{2}-\\d{2}\\.json$`);
  const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter(f => re.test(f)).sort().reverse() : [];
  for (const f of files) {
    try { return { name: f, data: readLibraryFile(path.join(BACKUP_DIR, f)) }; } catch { /* try the next older one */ }
  }
  return null;
}

function loadDB(space) {
  const lib = SPACES[space];
  lib.notice = null;
  try {
    lib.data = readLibraryFile(lib.file);
  } catch (err) {
    // A missing file is a first run. A file that exists but won't parse is kept
    // aside instead of being silently overwritten by the next save, and the
    // newest backup takes its place so Omniview doesn't start empty.
    lib.data = JSON.parse(JSON.stringify(lib.defaults));
    if (err.code !== 'ENOENT') {
      const aside = `${lib.file}.corrupt-${Date.now()}`;
      fs.renameSync(lib.file, aside);
      console.error(`${path.basename(lib.file)} was unreadable (${err.message}); moved to ${aside}`);
      const backup = newestBackup(lib);
      if (backup) {
        lib.data = backup.data;
        lib.dirty = true; // write the restored library back as the real file
        lib.notice = `Restored from backup ${backup.name.match(/\d{4}-\d{2}-\d{2}/)[0]}: ${path.basename(lib.file)} was unreadable. The damaged file is kept as ${path.basename(aside)}.`;
        console.error(`Restored ${path.basename(lib.file)} from ${backup.name}`);
      }
    }
  }
  // Back-fill fields added after this file was first written
  if (!lib.data.types) lib.data.types = [...lib.defaults.types];
  if (!lib.data.foundVia) lib.data.foundVia = [...lib.defaults.foundVia];
  lib.data.trash ??= [];
  const problems = libraryProblems(lib.data);
  lib.data.entries.forEach(e => normalizeEntry(e, space));
  lib.data.trash.forEach(e => normalizeEntry(e, space));
  lib.data.boards.forEach(b => {
    b.description ??= ''; b.emoji ??= ''; b.color ??= ''; b.pinned = !!b.pinned;
    if (!Array.isArray(b.order)) b.order = [];
  });
  const broken = brokenImages(lib.data);
  if (broken.length) problems.push(`${broken.length} screenshot file${broken.length === 1 ? ' is' : 's are'} missing from uploads/`);
  problems.slice(0, 20).forEach(p => console.warn(`${path.basename(lib.file)}: ${p}`));
  if (problems.length > 20) console.warn(`${path.basename(lib.file)}: ...and ${problems.length - 20} more problems`);
}

function readDB() {
  return SPACES[currentSpace()].data;
}

// Writes are debounced: a burst of mutations (favorite toggles, bulk edits)
// costs one disk write. `flushDB` is also called on shutdown and by tests, and
// saves every space that changed.
let saveTimer = null;
let saving = Promise.resolve();
// Message of a space's failed write (lib.saveError), cleared by its next good write.
const saveError = () => Object.values(SPACES).find(l => l.saveError)?.saveError || null;

function writeDB(data, lib = SPACES[currentSpace()]) {
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
  purgeTrash(false, lib); // a server left running for weeks still empties its trash
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
      lib.saveError = null;
      console.log(`[${new Date().toISOString()}] ${name} written (${data.entries.length} entries, ${data.boards.length} boards)`);
    }).catch(err => {
      lib.dirty = true;
      lib.saveError = `${name}: ${err.code || err.message}`;
      console.error(`Failed to write ${name}:`, err);
      // The user may free some space; try again rather than wait for the next edit.
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushDB, 10000);
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
if (Object.values(SPACES).some(l => l.dirty)) saveTimer = setTimeout(flushDB, 200); // a library restored from a backup

// ─── Files and the trash ─────────────────────────────────────────────────────
const thumbName = file => file.replace(/\.[^.]+$/, '.webp');

function removeFiles(file) {
  fs.rmSync(path.join(UPLOADS_DIR, file), { force: true });
  fs.rmSync(path.join(THUMBS_DIR, thumbName(file)), { force: true });
}

// ─── Trash ────────────────────────────────────────────────────────────────────
// Deleting moves an entry (and keeps its files) into db.trash, so every other
// route simply never sees it. Restoring puts it back; after TRASH_DAYS it is purged.
const TRASH_DAYS = 30;

function trashEntry(db, entry) {
  db.entries.splice(db.entries.indexOf(entry), 1);
  entry.deleted_at = new Date().toISOString();
  db.trash.push(entry);
}

// Permanently drops trashed entries older than TRASH_DAYS (all of them when `all`), files included.
function purgeTrash(all = false, lib = SPACES[currentSpace()]) {
  const db = lib.data;
  const cutoff = Date.now() - TRASH_DAYS * 864e5;
  const gone = db.trash.filter(e => all || Date.parse(e.deleted_at) < cutoff);
  if (!gone.length) return;
  db.trash = db.trash.filter(e => !gone.includes(e));
  gone.forEach(e => e.screenshots.forEach(removeFiles));
  writeDB(db, lib);
}

// Runs the rest of the chain inside the request's space. It sits after the body
// parsers on purpose: they call next() from a stream event, which drops the async
// context on some Node versions if it was entered before them. multer does the
// same, so the upload route re-binds after it.
const bindSpace = (req, res, next) => spaceStore.run(req.space || 'ui', next);

module.exports = {
  DB_PATH, UPLOADS_DIR, THUMBS_DIR, BACKUP_DIR, LOCK_PATH, TRASH_DAYS,
  SPACES, currentSpace, readDB, writeDB, flushDB, flushSync, saveError, loadDB, libraryProblems, brokenImages,
  thumbName, removeFiles, trashEntry, purgeTrash, bindSpace, spaceStore
};
