'use strict';

// Screenshots: thumbnails, palette, EXIF, duplicate detection, uploads.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { UPLOADS_DIR, THUMBS_DIR, SPACES, spaceStore, readDB, writeDB, thumbName, removeFiles } = require('./store');
const { httpError } = require('./validate');

// ─── Images: thumbnails + palette ────────────────────────────────────────────
// Extension is picked from the allowlisted mimetype, never the client-supplied
// filename — an .svg can carry a <script> and gets served same-origin from
// /uploads, so letting the client dictate the extension is a stored-XSS vector.
const ALLOWED_IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const MAX_SCREENSHOTS = 10;


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

// Camera photos carry GPS in EXIF, and originals are stored and exported as uploaded.
// Re-encode only files that have EXIF (screenshots don't), applying the orientation first.
async function stripExif(file) {
  const src = path.join(UPLOADS_DIR, file);
  const img = sharp(src);
  const { exif, format } = await img.metadata();
  if (!exif) return;
  // sharp drops metadata by default; q95 keeps a JPEG/WebP/AVIF re-encode visually identical.
  fs.writeFileSync(src, await img.rotate().toFormat(format, { quality: 95 }).toBuffer());
}

// Byte-identical duplicate detection. Each entry remembers the SHA-256 of its files
// (image_hashes), so only screenshots saved before that field existed are ever read
// again. /api/optimize rewrites files and clears them. A re-saved or re-encoded copy
// of the same picture won't match.
const hashFile = file => fs.promises.readFile(path.join(UPLOADS_DIR, file)).then(buf => crypto.createHash('sha256').update(buf).digest('hex'), () => null);

// The entry (in either library, trash included) that already has this image, if any.
async function findDuplicateImage(file, hash) {
  let found = null;
  for (const [space, lib] of Object.entries(SPACES)) {
    let learned = false;
    for (const e of [...lib.data.entries, ...lib.data.trash]) {
      for (const f of e.screenshots) {
        if (f === file) continue;
        if (!e.image_hashes[f]) {
          e.image_hashes[f] = await hashFile(f);
          learned = learned || !!e.image_hashes[f];
        }
        if (!found && e.image_hashes[f] === hash) found = { id: e.id, title: e.title || e.url, space, trashed: !!e.deleted_at };
      }
    }
    if (learned) writeDB(lib.data, lib);
    if (found) return found;
  }
  return null;
}

// Files multer/URL-download has written but that no entry references yet; the
// orphan cleanup must not treat them as unused.
const attaching = new Set();

// Shared by file upload and "use the page's og:image": processes the already
// saved file and appends it to the entry (the first one becomes the cover).
async function attachScreenshot(entryId, file, remote = false) {
  attaching.add(file);
  try {
    let palette;
    try {
      await stripExif(file);
      palette = await processImage(file);
    } catch {
      removeFiles(file);
      throw httpError(400, 'Could not read that image');
    }
    const hash = await hashFile(file);
    const duplicateOf = hash ? await findDuplicateImage(file, hash) : null;
    const entry = readDB().entries.find(e => e.id === entryId);
    if (!entry || entry.screenshots.length >= MAX_SCREENSHOTS) {
      removeFiles(file);
      throw entry ? httpError(400, `An entry can have at most ${MAX_SCREENSHOTS} screenshots`) : httpError(404, 'Entry not found');
    }
    entry.screenshots.push(file);
    if (remote) entry.remote_shots.push(file);
    if (hash) entry.image_hashes[file] = hash;
    if (!entry.palette.length) entry.palette = palette;
    writeDB(readDB());
    return { entry, duplicateOf };
  } finally {
    attaching.delete(file);
  }
}

// ─── Multer (screenshot uploads) ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_IMAGE_TYPES[file.mimetype]}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) return cb(new Error('UNSUPPORTED_FILE_TYPE'));
    cb(null, true);
  }
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

module.exports = {
  ALLOWED_IMAGE_TYPES, MAX_SCREENSHOTS, upload, attaching,
  extractPalette, attachScreenshot, backfillImages
};
