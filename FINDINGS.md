# Omniview: Findings

Reviewed 2026-10-08. **Not repeated here:** items already in `UI_UX_IDEAS.md` "Open" (disable save buttons, mobile sidebar auto-collapse, Cmd+K palette, favicons). Tags: **[H]** high, **[M]** medium, **[L]** low. `[ ]` = open.

# Skip
- [ ] **[L]** Share a board as a static HTML folder (export board only).
- [ ] **[L]** Move storage to SQLite (`node:sqlite`) when the library passes ~1,000 entries; JSON is fine until then.
- [ ] **[L]** Browser extension or bookmarklet: one click captures URL + visible-tab screenshot (`chrome.tabs.captureVisibleTab`) and POSTs to `localhost`. This is the natural next step for a capture tool.
- [ ] **[M]** Per-entry fields for what you actually reference: font names, color hex palette, "what I like" note, so notes are structured and searchable.
- [ ] **[M]** Saved searches / smart collections (e.g. "Dark Mode + Dashboard"). Filters already persist in `localStorage`; name them and list them in the sidebar.
- [ ] **[H]** Import. Export exists (`/api/export`, JSON + ZIP) but there is no way to restore from it. Add `POST /api/import` accepting the ZIP (merge or replace) and a Settings button.
- [ ] **[H]** Personal data is committed to git: `db/library.json` and 30 files in `uploads/` (28 MB `.git`) are tracked, and `.gitignore` covers neither. README promises "Local only, no sharing". Run `git rm -r --cached uploads db/library.json`, add both to `.gitignore`. If the repo was ever pushed publicly, rewrite history or rotate what's in the notes.

# Completed

## Security / data safety
- [x] **[H]** Cross-site wipe: `POST /api/reset` needs no body and no confirmation (`server.js:461`). A simple cross-origin `fetch('http://localhost:3737/api/reset', {method:'POST'})` from any website you visit is a CORS "simple request", so it executes. Fix: require a custom header (e.g. `X-Omniview: 1`, forces preflight) on all non-GET routes, plus an `Origin`/`Host` allowlist middleware (`localhost:PORT` only; also blocks DNS rebinding). *Done: Host/Origin allowlist, `X-Omniview` header on all non-GET requests, and `/api/reset` now also needs `{"confirm":"reset"}`.*
- [x] **[M]** No type validation on write. `POST/PUT /api/entries` copies `style_tags`, `boards`, `favorite` etc. as-is (`server.js:154,192`). Sending `style_tags: "x"` makes later `.includes`/`.some`/`.filter` calls misbehave or throw 500. Validate: arrays of strings, boolean `favorite`, string lengths, `type`/`found_via` in the managed lists (or auto-create).
- [x] **[M]** `bulk` crashes on old entries missing `style_tags`/`boards` (`server.js:249,254`: `.includes` on undefined). Default with `(e.style_tags ||= [])`, or normalise every entry in `loadDB()`.
- [x] **[M]** URLs are not validated: `url` can be `javascript:...` and is rendered into `<a href>` (`public/app.js:781,929,1673`). Click "open site" runs script in the app origin. Accept only `http(s):` on the server, and set `href` only when the scheme matches on the client.
- [x] **[M]** Unescaped tag inside an HTML attribute: `aria-label="Remove ${tag}"` (`public/app.js:1479`). A tag containing `"` breaks out of the attribute. Use `escHtml(tag)` or build the button with `createElement` + `setAttribute`.
- [x] **[L]** Bulk `tag` action can add tags that don't exist in `db.tags` (`server.js:248`), and entry create/update accepts unknown tags. Either reject or auto-register to keep filters consistent.
- [x] **[L]** `process.on('uncaughtException')` swallows fatal errors and keeps running in an unknown state (`server.js:501`). Log, then exit; let `nodemon`/systemd restart.
- [x] **[L]** `decodeURIComponent` on route params can throw on malformed `%` sequences (`server.js:335`+). Express already decodes `req.params`; double-decode also breaks names that contain `%`. Remove the extra call.

## Performance / efficiency
- [x] **[H]** Full-size PNGs are served in the grid. 33 MB for 27 shots, up to 4.4 MB each, uploads allow 50 MB (`server.js:84`). Generate a ~600 px WebP thumbnail on upload (`sharp`, or `<canvas>` resize in the browser before upload) and use it in cards/list; load the original only in the detail modal.
- [x] **[M]** Cache headers: `/uploads` filenames are UUIDs, so they are immutable. `express.static(UPLOADS_DIR, { maxAge: '365d', immutable: true })`. Also add `compression()` for JSON/JS/CSS (or at least pre-minify; `app.js` is 2,026 lines unminified).
- [x] **[M]** `writeDB` is synchronous and rewrites the whole pretty-printed JSON plus a `.bak` copy on every mutation, including favorite toggles (`server.js:57-68`). Fine at 27 entries, painful at thousands. Debounce writes (~200 ms) and use async `fs.promises`; drop `null, 2` indent in the main file.
- [x] **[M]** Single rolling `.bak` is overwritten on every write, so two bad writes in a row lose the good copy. Keep a daily timestamped backup (`library-YYYY-MM-DD.json`, keep last 7).
- [x] **[L]** `/api/boards` does an O(boards x entries) count per request (`server.js:268`). Fine now; precompute with one pass over entries.
- [x] **[L]** Filtering and sorting are done on the server, but the client also keeps `state.entries` and re-filters (`applyFilters`, `app.js:672`). Pick one place. Server-side filtering plus client-side re-filter is duplicate logic that can drift (e.g. search checks the same four fields in two places). *Done: filtering now lives only in the browser (`applyFilters`); the unused server-side filter on `GET /api/entries` was removed.*
- [x] **[L]** Client does full `innerHTML = ''` + rebuild of the grid on every filter keystroke (`renderGrid`, `app.js:741`). Debounce the search input (150 ms) and consider virtualised rendering past ~500 cards. *Done: search is debounced (150 ms). Virtualised rendering is not added; not needed until ~500 cards.*
- [x] **[L]** Orphaned uploads: if a screenshot upload succeeds but the entry write fails, or an entry is edited elsewhere, files stay in `uploads/` forever. Add a startup (or Settings button) "Clean unused files" that deletes files not referenced by any entry.

## UI / UX
- [x] **[H]** Auto-fill from URL: on pasting a URL, fetch the page server-side (Node `fetch`) and pre-fill title, `og:image`/favicon, and `theme-color`. Removes most manual typing and fixes the favicon idea in the UI backlog without an external service.
- [x] **[H]** Duplicate URL handling: the server returns `isDuplicate` but still creates the entry (`server.js:157-177`). Normalise URLs (strip trailing slash, `www.`, tracking params, http vs https) and show "Already saved: open it / add anyway" in the form.
- [x] **[M]** Image zoom/lightbox in the detail modal; arrow-key prev/next through the current filtered list without closing the modal.
- [x] **[M]** Color is a fixed 12-name list (`app.js:116`). Extract a real dominant palette from the screenshot (canvas sampling, no deps) and filter by swatch. *Done: palette is extracted server-side with sharp (not canvas) at upload and backfilled at startup; the filter is a swatch grid.*
- [x] **[M]** Masonry/true aspect-ratio grid: tall mobile screenshots and wide desktop ones are cropped to the same card. Offer "fit" vs "cover" or masonry layout.
- [x] **[M]** Tag management lacks merge, bulk delete, and usage counts sorted. Settings lists show counts only through delete warnings (`tagUsage`). Show count next to each tag, sortable.
- [x] **[M]** Bulk mode: only tag / delete / add-to-board. Add "remove tag", "set type", "remove from board", "favorite all".
- [x] **[L]** Empty library state: first run shows an empty grid. Add a "Paste a screenshot, or drop an image anywhere" card with the keyboard hint (`setupPasteImage` already exists).
- [x] **[L]** Only 6 `aria-*`/`role` attributes in `index.html`. Add `aria-label`s to icon buttons (fav, open site, remove-from-board, sidebar toggle) and `aria-pressed` on favorite and layout buttons.
- [x] **[L]** Drag-and-drop from the desktop onto the whole window (not only the drop zone) to start a new entry.
- [x] **[L]** Drag cards between boards in the Boards view.
- [x] **[L]** Show total/filtered counts ("12 of 27") near the search bar.
- [x] **[L]** Respect `prefers-reduced-motion` for the sidebar and toast animations; check `styles.css` for transitions without the query.

## New features
- [x] **[M]** Multiple screenshots per entry (hero + inner pages, mobile + desktop) with a small carousel. Needs `screenshots: []` in the schema and a one-time migration of `screenshot`.
- [x] **[L]** Random entry / "inspire me" button; "recently viewed".

## Remove / clean up
- [x] **[M]** Delete the loose `Screenshot 2026-10-01 ... Omniview.png` from the repo root (use it in README or move to `docs/`); README still says "[image coming soon]" 3 times.
- [x] **[M]** `package.json` pins `express ^4`; Express 5 is current and async handlers get error forwarding for free. Low-risk upgrade given the test suite exists.
- [x] **[L]** README project structure omits `test/`, `uploads/`, and the export/import API. Document the endpoints and the `OMNIVIEW_DB_PATH` / `OMNIVIEW_UPLOADS_DIR` env vars.
- [x] **[L]** Duplicate "open site" SVG string pasted at `app.js:785` and `:933`. Move to one `OPEN_ICON` constant (same pattern as `PLACEHOLDER_SVG`).
- [x] **[L]** `public/app.js` is a single 2,026-line file. Split into ES modules (`api.js`, `render.js`, `modals.js`, `state.js`) with `<script type="module">`; no bundler needed.
- [x] **[L]** `/api/stats` and `refreshStats` could be derived from the already-loaded `state.entries`; one fewer request per mutation. *Done: counters derive from `state`; the endpoint was removed.*
- [x] **[L]** Test gaps: no tests for export, reset, board delete cascade, tag delete cascade, or concurrency. Add 4-5 more cases in `test/api.test.js`; CI via a one-line GitHub Action (`npm test`).
