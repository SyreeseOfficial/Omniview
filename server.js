'use strict';
// Type-checked with `npm run typecheck`; the entry shape is in server/types.js.

// package.json "engines" only warns; the code uses AbortSignal.timeout, Object.hasOwn and ??=, so say it plainly.
if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`Omniview needs Node 20 or newer (this is ${process.version}).`);
  process.exit(1);
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('./server/store');
const multer = require('multer');
const images = require('./server/images');

const { SPACES, LOCK_PATH, UPLOADS_DIR, saveError, flushDB, flushSync, libraryProblems, bindSpace, spaceStore, purgeTrash } = store;

const app = express();
const PORT = Number(process.env.PORT) || 3737;

// ─── Middleware ───────────────────────────────────────────────────────────────
const REDACT_QUERY = /^\/api\/(unfurl|entries\/[^/]+\/screenshot-url)$/;
const logUrl = req => (REDACT_QUERY.test(req.path) ? req.path : req.originalUrl);
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Thumbnails and static assets would bury real errors and writes.
    if (res.statusCode < 400 && !req.originalUrl.startsWith('/api')) return;
    // Fetched shop URLs can carry session or signed-token params; keep them out of scrollback.
    console.log(`[${new Date().toISOString()}] ${req.method} ${logUrl(req)} ${res.statusCode} ${Date.now() - start}ms`);
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
  res.locals.space = space;
  next();
});

// Every API answer says whether the last write failed, so the UI can warn at once
// instead of looking fine while changes pile up in memory.
app.use('/api', (req, res, next) => {
  const err = saveError();
  if (err) res.setHeader('X-Save-Error', err.replace(/[^\x20-\x7e]/g, '?'));
  next();
});
app.get('/api/spaces', (req, res) => res.json(Object.entries(SPACES).map(([name, lib]) => ({
  name, label: lib.label, fields: Object.keys(lib.fields), features: lib.features, notice: lib.notice
}))));
// Limits the browser needs to agree with, so they live in one place.
app.get('/api/config', (req, res) => res.json({ maxScreenshots: images.MAX_SCREENSHOTS }));

// 100 kb covers every route except bulk (up to 5000 ids, ~40 bytes each).
app.use('/api/entries/bulk', express.json({ limit: '300kb' }));
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { req.body ??= {}; next(); }); // Express 5 leaves body undefined when none was sent

app.use('/api', bindSpace);

// No bundler means no content hashes in file names, so a max-age would serve stale
// modules after an update. no-cache still uses the ETag: unchanged files are a 304.
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
// Filenames are UUIDs and never rewritten, so browsers can cache them forever.
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '365d', immutable: true }));

app.use(require('./server/routes/entries'));
app.use(require('./server/routes/trash'));
app.use(require('./server/routes/boards'));
app.use(require('./server/routes/lists'));
app.use(require('./server/routes/data'));
app.use(require('./server/unfurl'));

// ─── Error handling ───────────────────────────────────────────────────────────
// Catches thrown errors from route handlers (sync or async — Express 5 forwards
// both) and multer's fileFilter/limits errors, so a bad request gets a clean
// JSON response instead of Express's default HTML stack trace.
app.use((err, req, res, next) => {
  if (err.message === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(400).json({ error: 'Only PNG, JPEG, WEBP, GIF, or AVIF images are allowed' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`[${new Date().toISOString()}] ${req.method} ${logUrl(req)} error:`, err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
// Two servers on one database would silently overwrite each other's writes, so
// the first one claims `.lock` (its PID) and a second refuses to start. A lock
// left by a crashed process (PID no longer running) is taken over.
// ponytail: a PID recycled by an unrelated process after a reboot looks alive; delete db/.lock by hand then.
function acquireLock(lockPath) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const pid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
      let alive;
      try { process.kill(pid, 0); alive = pid !== process.pid; } catch (e) { alive = e.code === 'EPERM'; }
      if (alive || attempt) throw new Error(`Another Omniview (PID ${pid}) is already using ${path.dirname(lockPath)}. Stop it first, or delete ${lockPath} if it is not running.`, { cause: err });
      fs.rmSync(lockPath, { force: true });
    }
  }
}

module.exports = Object.assign(app, { flushDB, acquireLock, libraryProblems });

if (require.main === module) {
  // A fatal error leaves the process in an unknown state: log it and exit
  // rather than carry on (the pending save is flushed by the exit handler).
  process.on('uncaughtException', err => { console.error('Uncaught exception:', err); process.exit(1); });
  process.on('unhandledRejection', err => { console.error('Unhandled rejection:', err); process.exit(1); });
  try {
    acquireLock(LOCK_PATH);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  process.on('exit', () => {
    flushSync();
    fs.rmSync(LOCK_PATH, { force: true });
  });
  ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, async () => { await flushDB(); process.exit(0); }));

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🎨 Omniview running at http://localhost:${PORT}\n`);
    images.backfillImages();
    Object.keys(SPACES).forEach(space => spaceStore.run(space, () => purgeTrash()));
  });
}
