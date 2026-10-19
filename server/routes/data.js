'use strict';

// Export, storage report, cleanup and optimise.
const path = require('path');
const fs = require('fs');
const express = require('express');
const archiver = require('archiver');
const sharp = require('sharp');
const { DB_PATH, UPLOADS_DIR, THUMBS_DIR, BACKUP_DIR, SPACES, currentSpace, readDB, flushDB, brokenImages, thumbName } = require('../store');
const { attaching } = require('../images');
const { httpError } = require('../validate');

const router = express.Router();

// ─── Export ───────────────────────────────────────────────────────────────────
const EXPORT_VERSION = 1; // bump when the exported shape changes in a way an importer must care about
router.get('/api/export', (req, res) => {
  const fmt = req.query.format ?? 'json';
  if (fmt !== 'json' && fmt !== 'zip') throw httpError(400, 'format must be json or zip');
  const space = currentSpace();
  const data = readDB();
  // The trash isn't part of the library you'd move or back up, and image_hashes is a cache. See docs/EXPORT_FORMAT.md.
  const db = { version: EXPORT_VERSION, space, ...data, trash: undefined, entries: data.entries.map(({ image_hashes, ...e }) => e) };
  const base = space === 'ui' ? 'omniview-export' : `omniview-${space}-export`;

  if (fmt === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
    res.json(db);
  } else {
    // ZIP with JSON + screenshots
    res.setHeader('Content-Disposition', `attachment; filename="${base}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    const archive = /** @type {any} */ (archiver)('zip'); // @types/archiver lags the package
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
// Upload files (and thumbnails) that no entry references, e.g. left behind when
// an upload succeeded but the entry was never saved. GET previews, POST deletes.
function sweepUnused(dryRun) {
  const used = new Set(attaching);
  // Uploads are shared by every space, so a file is unused only if no space's entries reference it.
  Object.values(SPACES).forEach(lib => [...lib.data.entries, ...lib.data.trash].forEach(e => e.screenshots.forEach(f => used.add(f))));
  let removed = 0;
  let bytes = 0;
  const sweep = (dir, isUsed) => fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && !isUsed(d.name))
    .forEach(d => {
      const p = path.join(dir, d.name);
      bytes += fs.statSync(p).size;
      if (!dryRun) fs.rmSync(p);
      removed++;
    });
  sweep(UPLOADS_DIR, name => used.has(name));
  const usedThumbs = new Set([...used].map(thumbName));
  sweep(THUMBS_DIR, name => usedThumbs.has(name));
  return { removed, bytes };
}
router.get('/api/cleanup', (req, res) => res.json(sweepUnused(true)));
router.post('/api/cleanup', (req, res) => res.json(sweepUnused(false)));

// Re-encodes originals as WebP capped at MAX_ORIGINAL_PX. The UUID in the file name
// is kept (only the extension changes), so thumbnails stay valid; every entry in
// both libraries that referenced the file is repointed. GIFs (maybe animated) and
// AVIFs (already compact) are left alone, as is anything that wouldn't get smaller.
const MAX_ORIGINAL_PX = 2400;
router.post('/api/optimize', async (req, res) => {
  const renames = new Map();
  let saved = 0;
  const files = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true }).filter(d => d.isFile() && /\.(png|jpe?g|webp)$/i.test(d.name));
  for (const { name } of files) {
    if (attaching.has(name)) continue;
    const src = path.join(UPLOADS_DIR, name);
    try {
      const meta = await sharp(src).metadata();
      if (meta.pages > 1) continue;
      const buf = await sharp(src).rotate().resize({ width: MAX_ORIGINAL_PX, height: MAX_ORIGINAL_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
      const before = fs.statSync(src).size;
      if (buf.length >= before) continue;
      const next = name.replace(/\.[^.]+$/, '.webp');
      fs.writeFileSync(`${src}.tmp`, buf);
      fs.renameSync(`${src}.tmp`, path.join(UPLOADS_DIR, next));
      if (next !== name) renames.set(name, next);
      saved += before - buf.length;
    } catch { /* unreadable file: leave it */ }
  }
  if (renames.size) {
    const swap = f => renames.get(f) ?? f;
    for (const lib of Object.values(SPACES)) {
      [...lib.data.entries, ...lib.data.trash].forEach(e => {
        if (!e.screenshots.some(f => renames.has(f))) return;
        e.screenshots = e.screenshots.map(swap);
        e.remote_shots = e.remote_shots.map(swap);
        lib.dirty = true;
      });
    }
    await flushDB(); // references are on disk before the old files go
    renames.forEach((_, old) => fs.rmSync(path.join(UPLOADS_DIR, old), { force: true }));
  }
  // Files were rewritten, so every remembered hash is stale; they are learned again on the next upload.
  if (saved) {
    for (const lib of Object.values(SPACES)) {
      [...lib.data.entries, ...lib.data.trash].forEach(e => { e.image_hashes = {}; });
      lib.dirty = true;
    }
    await flushDB();
  }
  res.json({ converted: renames.size, saved });
});

// Files directly inside `dir` (subfolders are counted on their own).
function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  for (const d of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    if (!d.isFile()) continue;
    files++;
    bytes += fs.statSync(path.join(dir, d.name)).size;
  }
  return { files, bytes };
}

router.get('/api/storage', (req, res) => {
  res.json({
    dataDir: path.dirname(DB_PATH),
    uploadsDir: UPLOADS_DIR,
    spaces: Object.fromEntries(Object.entries(SPACES).map(([name, lib]) => [name, { entries: lib.data.entries.length, trash: lib.data.trash.length, brokenImages: brokenImages(lib.data).length }])),
    uploads: dirStats(UPLOADS_DIR),
    thumbs: dirStats(THUMBS_DIR),
    backups: dirStats(BACKUP_DIR)
  });
});

module.exports = router;
