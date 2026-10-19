# Fashion space: design record

Decided and built 2026-10-17 (a record of the decisions and what shipped; see "As built" at the bottom; tests in `test/api.test.js` under "Spaces"). Linked from the [README](../README.md). Goal: use Omniview as a fashion wishlist too, in the same app, on the same `localhost:3737`.

## Decisions

- **One app, one port, two libraries ("spaces").** UI inspiration stays as is. Fashion is a second library. A toggle at the top of the sidebar switches between them; no second browser tab, no second server.
- **Never shown together.** Each space has its own entries, tags, boards, types, found-via list.
- **Fashion fields:** `name` (existing `title`), `type` (existing managed list: Jacket, Pants, Shoes...), plus two new plain-text fields: `price` (typed by hand, e.g. "$120") and `brand` (free text, not a managed list).
- **No status field.** Use a "bought" tag or board; delete when no longer wanted.
- **No price tracking / scraping.** Price is typed in.
- **Color swatch filter:** ignored in fashion space (product photos have white backgrounds, so palettes would be junk). Hide it there.
- **Mobile:** not a concern. Phone finds go into Obsidian (synced) as URLs, then get added to Omniview from the laptop in batches.

## Rejected

- **Second instance via env vars** (`PORT`, `OMNIVIEW_DB_PATH`, `OMNIVIEW_UPLOADS_DIR`): works today with zero code, but needs a second port. Rejected: wants one localhost.
- **`OMNIVIEW_MODE=fashion` flag:** same problem, one mode per process.
- **One shared library with a `space` field on entries:** tags, boards and types would be one shared namespace ("Minimal" means different things in each).
- **Separate `/fashion` URL:** unnecessary; the sidebar toggle replaces it.

## Design

1. **Client** (`public/js/api.js`): send `X-Space: ui|fashion` on every request. Current space kept in `localStorage`; the sidebar toggle sets it and reloads data.
2. **Server** (`server.js`): the server keeps one global in-memory `cache` and about 70 call sites go through `readDB()` / `writeDB()`. Make those two functions space-aware so the routes stay untouched.
   - A middleware reads `X-Space` and runs the request inside `AsyncLocalStorage`. A plain module-level variable would be unsafe: some routes `await` a page fetch, so requests would interleave.
   - Libraries: `{ ui: ..., fashion: ... }`, each with its own file (`db/library.json`, `db/fashion.json`).
   - Uploads folder is shared (filenames are UUIDs).
3. **Entry form:** show `price` and `brand` only in the fashion space; fashion default `types` list; no default style tags.

## Risks to handle (do first)

- **Orphan-file sweep** (`server.js` ~line 832, `sweep`): deletes uploads no entry uses. If it only checks the current space's entries, using one space deletes the other space's screenshots. **Write a test for this before changing anything else.**
- Per-space handling needed for: the debounced save (`flushDB`) and daily backup (`backupDaily`), `/api/export`, `/api/reset`.
- `normalizeEntry` and the DB back-fill in `loadDB` need to apply to both libraries; the fashion default DB differs from `DEFAULT_DB`.
- Existing tests in `test/api.test.js` point at a throwaway DB via env vars; extend them for the `X-Space` header.

## Estimate

About half a day, mostly the four server spots above and their tests. The `price`/`brand` fields and the toggle are quick.

## Known limits

- No searching across both libraries.
- Fashion sites often block bots or have messy page titles ("Men's Jacket | Brand - Shop Online"), so the URL metadata fetch will fail or need cleanup more often than for design sites. Not tested. The screenshot paste is the fallback.
- Product links rot (sold out, 404). The saved thumbnail is the record.

## Maybe later

- **Batch add** (also in `FINDINGS.md`, Skip section): paste many URLs, one per line (e.g. copied from Obsidian), each run through the existing `/api/fetch` and saved with duplicate detection; failures reported at the end. Estimate 1-2 hours. Helps the UI space too.
- Import/restore from the export ZIP (`FINDINGS.md` `[H]`, still open). Matters more once the fashion library exists, since a wipe now loses two libraries.

## As built

- `server.js`: `SPACES = { ui, fashion }`, each with its file and defaults. `readDB()` / `writeDB()` pick the space from `AsyncLocalStorage`; `/api` middleware validates `X-Space` (or `?space=`), and `bindSpace` enters the store after the body parsers and again after multer.
- Fashion fields are only accepted in the fashion space (`price` max 50, `brand` max 100). Default fashion types and found-via lists differ; no default tags.
- Per space: save file, daily backup (`fashion-DATE.json`), export, reset. Shared: uploads, and the cleanup sweep (checks both libraries).
- Client: `X-Space` on every request, `state.space` in `localStorage`, filters and recents stored per space, `G` toggles, fashion accent color. `<html data-space>` plus `.ui-only` / `.fashion-only` drive what shows.
- Fashion also relabels Title→Name and Style Tags→Tags, skips the theme-color autofill, hides the palette, and searches brand.
