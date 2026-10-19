# Omniview: Ideas

Brainstormed 2026-10-18 against the current code (both spaces, autofill, Express 5, ES modules). Everything here is **new**: nothing repeats an item already in `FINDINGS.md` (those are cross-referenced at the end where one deserves a higher priority).

Priority: **[H]** do soon · **[M]** worth it · **[L]** nice to have · **[?]** big bet / needs a decision. `[ ]` open, `[x]` done.

**Contents:** 1 Fashion · 2 Capture & autofill · 3 Browse & search · 4 Entry detail · 5 Boards · 6 Tags & lists · 7 Visual polish · 8 Accessibility · 9 Performance · 10 Data safety · 11 Security & privacy · 12 Code, tests & dev · 13 Docs & repo · 14 Big bets · 15 Round 2 · 16 Reprioritise from FINDINGS · 17 Decisions to revisit

---

## 1. Fashion wishlist

Real data check: `db/fashion.json` has prices like `"160"`, `"150.99"`, `"129.99"` (older entries predate the whole-dollar rounding), 0 tags, 0 notes, 0 boards on 12 entries.

All items from this section are under **Completed** or **Skipped** at the bottom.

## 2. Capture & autofill

All items from this section are under **Completed** or **Skipped** at the bottom.

## 3. Browse & search

All items from this section are under **Completed** or **Skipped** at the bottom.

## 4. Entry detail & editing

All items from this section are under **Completed** or **Skipped** at the bottom.

## 5. Boards

All items from this section are under **Completed** or **Skipped** at the bottom.

## 6. Tags & managed lists

All items from this section are under **Completed** or **Skipped** at the bottom.

## 7. Visual polish

All items from this section are under **Completed** or **Skipped** at the bottom.

## 8. Accessibility

All items from this section are under **Completed** or **Skipped** at the bottom.

## 9. Performance

All items from this section are under **Completed** or **Skipped** at the bottom.

## 10. Data safety & portability

All items from this section are under **Completed** or **Skipped** at the bottom.

## 11. Security & privacy

All items from this section are under **Completed** or **Skipped** at the bottom.

## 12. Code, tests & dev experience

- [ ] **[H]** Unit tests for `public/js/autofill.js`. It is pure (no DOM), `node --test` can import it, and it has no tests (`test/` only has `api.test.js`). Cases: brand known-vs-page, per-host prior brand, "Red Wing" scrubbing, `shirt jacket` ambiguity, `EUR 120` currency.
- [ ] **[M]** Fixture-based tests for `pageInfo` against realistic shop markup: Shopify, WooCommerce, Squarespace, `AggregateOffer`, `offers` as array, `priceSpecification` arrays, `hasVariant`. Autofill is the most fragile piece and the most used.
- [ ] **[M]** Collapse the three near-identical tags/types/found-via route groups (`server.js:752-892`, ~140 lines) into one `managedList(path, key, onRename, onDelete)` registration.
- [ ] **[M]** Split `server.js` (1,009 lines) into modules, mirroring the client: `store.js` (spaces, load/save/backup), `images.js`, `unfurl.js`, `routes/*.js`. The test suite makes it a safe refactor.
- [ ] **[M]** `// @ts-check` + JSDoc `@typedef Entry` and a `tsc --noEmit` script: type safety without a build step, and catches the `entry.palette` / `style_tags` shape drift that `normalizeEntry` guards by hand.
- [ ] **[M]** Serve shared constants from the server: `MAX_SCREENSHOTS` is duplicated in `entry.js:11` with a "keep in step" comment. A tiny `/api/config` (limits, space defaults) removes the drift risk.
- [ ] **[L]** `engines: { node: ">=20" }` in `package.json` (code uses `Object.hasOwn`, `AbortSignal.timeout`, `??=`); fail early with a clear message on old Node.
- [ ] **[L]** Add `GET /api/health` (uptime, entries per space, last save, last save error) for the banner above and for a service manager check.
- [ ] **[L]** ESLint or Biome config and `npm run lint` in CI (unused variables, accidental globals, `==`).
- [ ] **[L]** Playwright smoke test (add → tag → favorite → delete → undo) as an optional script, not in default `npm test`.
- [ ] **[L]** `npm run seed`: generate 30 sample entries with generated screenshots for demos, README images and manual testing without touching real data.
- [ ] **[L]** Dependabot (npm + actions) config; `sharp` and `express` are the two that matter.
- [ ] **[L]** `.editorconfig` and a single formatting convention (the code already reads consistently; lock it in).

## 13. Docs & repo

All items from this section are under **Completed** or **Skipped** at the bottom.

## 14. Big bets

All items from this section are under **Completed** or **Skipped** at the bottom.

---

## 15. Round 2

A second pass with fresh eyes on the code paths I didn't read closely the first time (validation, bulk, cleanup, export, autofill, the form).

### Server edge cases

All items from this section are under **Completed** or **Skipped** at the bottom.

### Client behavior

All items from this section are under **Completed** or **Skipped** at the bottom.

### Autofill depth

All items from this section are under **Completed** or **Skipped** at the bottom.

### Quality of life

All items from this section are under **Completed** or **Skipped** at the bottom.

---

## 16. Reprioritise from FINDINGS

All items from this section are under **Completed** or **Skipped** at the bottom.

## 17. Decisions to revisit (these reverse something in `FASHION_SPACE.md`)

All items from this section are under **Completed** or **Skipped** at the bottom.

---

## Completed

- [x] **[H]** Sort by price (low→high, high→low). The sort menu only has Newest / Oldest / A–Z / By Type (`browse.js` `SORT_OPTIONS`). Parse the number out of the text at sort time; no schema change needed to start.
- [x] **[M]** Running total in the stats line and on each board: `12 items · $1,420`. Respects the active filters, so "Shoes under $200" shows what that costs.
- [x] **[M]** Color filter for fashion. It is hidden (`ui-only`) because palettes are junk on white backgrounds, but fashion entries do have a hand/auto-filled `color` name. Show the swatch grid and match on `e.color` only.
- [x] **[M]** Brand filter dropdown with counts ("Dr. Martens 4"). Brand is searchable but not filterable.
- [x] **[M]** Group-by-brand / group-by-type headings in the grid, so the wishlist reads like a store.
- [x] **[L]** "Hide bought" toggle in fashion that filters out a tag named `bought`, if you keep that convention instead of a status field.
- [x] **[H]** Retry `/api/unfurl` with a browser-like `User-Agent` when the first attempt returns 403/429. The fixed `compatible; Omniview/1.0` UA (`server.js:572`) is exactly what shops block, and fashion sites are the main use.
- [x] **[H]** Ignore bot-wall pages: if the title is "Just a moment...", "Access denied", "Attention Required", or a CAPTCHA, don't fill it into the title field; say "This site blocked the preview" instead.
- [x] **[H]** Accept AVIF. `ALLOWED_IMAGE_TYPES` lacks `image/avif` (`server.js:176`), and more shops serve AVIF `og:image`s, which fails with "Only PNG, JPEG, WEBP, or GIF". `sharp` already decodes it.
- [x] **[M]** Pasting a URL anywhere (not only into the URL field) opens the Add form with it filled and autofill running. The global paste handler (`main.js` `setupImageInput`) only takes files.
- [x] **[M]** "Save & add another" (Ctrl+Shift+Enter): keep the form open, clear URL/title only, keep Type/Found via/board. Pairs with the Obsidian-to-Omniview batching workflow.
- [x] **[M]** Autosave the Add form draft to `localStorage`. `beforeunload` warns but a crash or accidental tab close still loses a half-filled entry.
- [x] **[M]** Default "Found via" to the last value used, or guess it from the host (`pinterest.*` → Pinterest, `dribbble.com` → Dribbble, `instagram.com`, `reddit.com`).
- [x] **[L]** "Paste from clipboard" button in the Add form for URLs (one click instead of focus + Ctrl+V).
- [x] **[L]** Show progress and file size for pending uploads, and the stage ("Uploading 2 of 3...") on save; today the Save button just waits.
- [x] **[L]** Decode `<title>`/meta entities fully (`decodeEntities` handles a handful; `&nbsp;`, `&rsquo;`, `&#x27;` hex forms slip through). A tiny table or `he`-style lookup covers it.
- [x] **[L]** Remember, per host, which autofilled field you corrected (e.g. always change Type for this shop) and bias the next guess. `guessBrand` already does this for brand.
- [x] **[H]** Filter by Found via. It is stored on every entry and managed in Settings, but is the only metadata with no filter in the bar.
- [x] **[M]** Active-filter chips under the search bar (`type: Shoes ×`, `tag: Minimal ×`) so one filter can be dropped without clearing all (the current `filter-clear` clears everything).
- [x] **[M]** Faceted counts: show how many entries each tag/type/board would match under the current filters, and dim the zeros.
- [x] **[M]** Search box inside the Tags dropdown. The list is 26 default tags and will grow; scrolling a checkbox list is slow.
- [x] **[M]** Layout is global (`omniview-layout`), unlike filters/recents which are per-space via `spaceKey`. Let fashion default to a different layout than UI.
- [x] **[M]** Group-by control (none / month added / type / tag / board) with sticky headings; "October 2026" headers alone make a long list navigable.
- [x] **[M]** "More like this" in the detail view: rank other entries by palette distance (hex → Lab/RGB) plus shared tags. All data is already in memory.
- [x] **[M]** Card-size slider (min column width) in the toolbar, persisted per space.
- [x] **[M]** Filter by date added: "this week", "this month", custom range.
- [x] **[L]** Shuffle sort (stable per session) so the front of the library isn't always the newest.
- [x] **[L]** "Favorites first" sort option.
- [x] **[L]** Hover quick-actions on cards: favorite, add to board, copy URL, open (only open + favorite exist now).
- [x] **[L]** Keep scroll position and focused card when the detail modal closes and `renderBrowse` rebuilds the grid; verify and fix if it jumps to top.
- [x] **[L]** Optional "search both libraries" toggle that appends a "Also in Fashion (3)" section. `FASHION_SPACE.md` lists this as a known limit.
- [x] **[L]** Highlight cards that have no real screenshot differently from ones with an `og:image` stand-in.
- [x] **[H]** Guard the detail modal against unsaved edits. Clicking the overlay (`entry.js:451`) or pressing Esc calls `closeDetail()` with no dirty check, so typed notes are dropped silently. The Add form already has `isFormDirty`.
- [x] **[M]** Undo for non-delete bulk actions (tag, untag, set type, add to board, favorite). Only deletes get the 5-second Undo toast.
- [x] **[L]** Real zoom in the lightbox: wheel zoom + drag-pan. It toggles a `zoomed` class (`modals.js:143`), which is fine for desktop shots but awkward for tall mobile ones.
- [x] **[L]** Show "added 3 days ago" with the exact date on hover, plus the last-edited time once `updated_at` exists.
- [x] **[L]** Contrast badge for the cover palette: WCAG ratio between the two most dominant colors, so "does this dark theme actually pass" is visible.
- [x] **[M]** Board description/notes ("Client X rebrand, due Nov 3") shown at the top of the board.
- [x] **[M]** Reorder boards (drag) and pin favorite boards in the sidebar for one-click access.
- [x] **[M]** Manual ordering of entries inside a board (drag to arrange) for mood-board feel.
- [x] **[L]** Board accent color or emoji for quick scanning in the picker and sidebar.
- [x] **[L]** "Add to board" from the card hover menu without opening the detail modal.
- [x] **[M]** Suggest tags from the image: derive `Dark Mode` / `Light Mode` / `Monochrome` / `Colorful` from the stored palette lightness and saturation, offered as one-click chips in the form (never auto-applied).
- [x] **[L]** Tag aliases: typing `dark` suggests `Dark Mode`; typing `mono` suggests `Monochrome`.
- [x] **[L]** Warn when creating a near-duplicate tag (`Minimalist` vs `Minimal`, plural vs singular) before it lands.
- [x] **[H]** Add a favicon. `index.html` has no `<link rel="icon">`, so every load requests `/favicon.ico` and gets a 404. Reuse the sidebar brand-mark SVG (inline `data:` link is enough), with an accent variant for fashion.
- [x] **[M]** `color-scheme: dark light` (CSS + `<meta name="color-scheme">`) so native scrollbars, selects and form controls match the theme. Neither appears in `styles.css` or `index.html`.
- [x] **[M]** "System" theme option that follows `prefers-color-scheme` live, alongside Dark and Light.
- [x] **[L]** Skeleton cards instead of the spinner on first load.
- [x] **[L]** View Transitions API (`document.startViewTransition`) for card → detail and view switches; degrades to nothing where unsupported.
- [x] **[L]** User-pickable accent color in Settings (fashion already has its own).
- [x] **[L]** Compact list density toggle for the list layout.
- [x] **[L]** Print stylesheet so a board prints as a clean contact sheet.
- [x] **[M]** Visible focus rings everywhere. `:focus-visible` appears twice in 1,359 lines of CSS; buttons, cards, swatches, and filter pills likely fall back to defaults that the dark theme hides.
- [x] **[M]** Optimise originals: 43 files / 36 MB in `uploads/`, mostly PNG. Settings → "Optimise screenshots" converts to lossless/q90 WebP and caps at ~2400px would cut that by well over half. Keep the original name pattern so entries don't change.
- [x] **[M]** `<link rel="modulepreload">` for the 10 `public/js/*.js` modules; plain ES imports otherwise load in a waterfall.
- [x] **[L]** Add `decoding="async"` to `thumbImg` images so large grids don't block the main thread.
- [x] **[L]** Quiet the request log for static assets. Every page load prints ~50 lines (each thumb), burying real errors and writes.
- [x] **[L]** Cache the static `public/` assets with a content-hash query string or `ETag` + `maxAge`, since there is no bundler.
- [x] **[H]** Settings → "Check unused files" shows the count and size before deleting. `cleanup-btn` runs the sweep immediately, with no preview, on a button next to harmless ones.
- [x] **[H]** Surface save failures. `flushDB` catches write errors and only logs (`server.js:152`); the UI keeps saying everything is fine. Track `lastSaveError` and show a persistent banner ("Changes are not being saved: disk full?").
- [x] **[H]** Refuse to start a second server on the same database: write `db/.lock` (PID) at startup, remove on exit. Two `npm start` runs on different ports silently overwrite each other's writes.
- [x] **[M]** Soft delete with a Trash view (`deleted_at`, purge after 30 days). The 5-second Undo is the only safety net after a bulk delete.
- [x] **[M]** Storage panel in Settings: entries per space, upload size, thumbs size, backup size, data directory path.
- [x] **[L]** Validate the library shape on load and log specific problems (missing `id`, duplicate ids, a board referenced by an entry that no longer exists) instead of trusting it.
- [x] **[L]** Detect duplicate screenshots by content hash on upload and say "this image is already on <entry>".
- [x] **[M]** Cap request bodies per route (`express.json({ limit })`) and the bulk `ids` length; today `bulk` accepts any array that fits the default 100 kb.
- [x] **[L]** Log only the path (not the query) for `/api/unfurl` and `/api/entries/:id/screenshot-url`: saved shop URLs can carry session or signed-token params that then sit in terminal scrollback.
- [x] **[L]** Lint/test that flags template-literal `innerHTML` with an unescaped variable (grep-level check in `npm test`) to protect the 30 `innerHTML` sites.
- [x] **[L]** Strip EXIF (GPS) from uploads on processing. `sharp` drops it when re-encoding, but originals are stored as uploaded and shared in ZIP exports.
- [x] **[M]** README doesn't mention what Fashion autofill does now (JSON-LD brand/price/type/color, image picker, whole-dollar rounding). Add one bullet and a short "How autofill decides" section.
- [x] **[M]** Restructure `FINDINGS.md`: open items sit under a heading called "Skip", and open items from Round 2 are interleaved with done ones. A single `## Open` (sorted by priority) and `## Done` makes it usable as a to-do list.
- [x] **[L]** Rename `docs/FASHION_SPACE.md` from a "plan" to a design record ("as built" is already at the bottom) and link it from the README.
- [x] **[L]** Add a `LICENSE` (or an explicit "personal use" note) before the repo is shared.
- [x] **[L]** `CHANGELOG.md` generated from commit subjects; the history is already tidy ("Fashion autofill: ...").
- [x] **[L]** README section "Where is my data?" (paths, backups, how to move to another machine).
- [x] **[?]** Configurable spaces: `SPACES = { ui, fashion }` is hard-coded, and Fashion required touching four server spots. A spaces table (name, default lists, extra fields like `brand`/`price`) would make "Recipes", "Furniture" or "Books" a config entry.
- [x] **[?]** Stats page: entries per month, top tags, top found-via sources, an aggregate "your palette" strip across favorites.
- [x] **[M]** `PUT /api/boards/:id` with a blank name returns 200 and changes nothing (confirmed) (`server.js:722`), while `POST` returns 400. Return 400 so the client can show a message.
- [x] **[M]** `DELETE /api/tags/:name`, `/types/:name`, `/found-via/:name` return 200 for a name that doesn't exist; `PUT` returns 404. Make delete consistent so typos are not silent successes.
- [x] **[M]** Confirmed bug: `POST /api/tags/merge` with a blank `target` answers 400 but has already registered an empty-string tag (`canon(db.tags, '')` runs before the `!target` check, `server.js:771-772`); `GET /api/tags` then contains `""`. Validate non-empty before calling `canon`.
- [x] **[M]** Bulk `ids` that match nothing still return `{ ok: true }` and write the DB. Return the count changed so the UI can say "0 updated" and skip the write.
- [x] **[L]** `POST /api/entries/bulk` `favorite` treats anything but `false` as true (`value !== false`); require a boolean like the single-entry route does.
- [x] **[L]** `GET /api/export?format=` accepts any value other than `json` as ZIP; return 400 for unknown formats.
- [x] **[L]** Export JSON strips nothing and includes derived fields (`screenshot`, `palette`); document the schema and a `version` so an importer can trust it (pairs with FINDINGS' versioned shape).
- [x] **[M]** Space switch shows no loading state: `doSwitchSpace` awaits five requests then re-renders. Dim the grid or show the spinner during the switch so a slow response doesn't look like a hang.
- [x] **[M]** After a failed request in the middle of a bulk operation the selection is kept (good) but the toolbar doesn't say how many succeeded. Return per-id results from the server.
- [x] **[M]** Keyboard shortcuts `n`, `b`, `o`, `f`, `s`, `r`, `g`, `/` are hard-coded; make them remappable in Settings, or at least disable them with one toggle (they fire on any non-input focus, including after a click on a button).
- [x] **[L]** The Add form's `Color` is a combo of 12 names; for UI entries autofill from the first palette color name once the screenshot is attached (the info is computed server-side already).
- [x] **[L]** Time-box the toast Undo with a visible countdown bar so 5 seconds is understandable.
- [x] **[M]** Parse the price from the visible `<meta itemprop="price">` and `data-price` attributes when there is no JSON-LD; many small shops only have microdata.
- [x] **[M]** Fall back to Open Graph `product:*` tags for brand, availability and category (price is already handled).
- [x] **[L]** Currency symbol → code mapping when JSON-LD gives only `$`/`£`/`€` text instead of ISO codes.
- [x] **[L]** Treat `/products/...-sku` and trailing size/color variant parameters (`?variant=123`) as the same page in duplicate detection; Shopify URLs differ only by variant.
- [x] **[M]** One-click "open all links on this board" (confirm over 5; tabs opened this way count as visited; tells you if the browser blocked pop-ups).
- [x] **[L]** "Pin" an entry to the top of Browse regardless of sort (card button, list row, detail header; pinned badge on the card).
- [x] **[L]** "Last opened site" badge: opening the site from a card, row, detail link or "Open all" records `visited_at`; cards show a subtle "✓ visited" and the detail shows "site opened 3 days ago".
- [x] **[L]** Settings "Danger zone" in its own collapsed section; Factory reset needs the library name typed.
- [x] **[M]** First-paint theme fix: an inline script in `<head>` applies the saved theme, library and accent before the stylesheet paints.
- [x] **[M]** "Refresh price" button in the detail view: re-runs the unfurl price guess on the saved URL, puts the new price in the field and keeps the old one as `price_was` (shown as "(was 160)") once you save. Manual only, no background polling.
- [x] **[?]** "No price tracking": resolved by the manual Refresh price button above.
- [x] **[?]** "No status field": a `bought` flag (detail → Status → Bought). "Hide bought" is on by default in Fashion and hides the flag and the old `bought` tag.
- [x] **[?]** "Fashion ignores palette": the cover's first palette colour is now the card/row background while the thumbnail loads, in both libraries.

## Skipped

Parked for now, not rejected.

- [ ] **[H]** Price filter: "under $100", or a min/max pair, next to the Type filter. A wishlist is mostly a budget question.
- [ ] **[M]** Show the currency symbol. `brandPrice` renders `Dr. Martens · 160` (no `$`) because autofill stores bare digits. Format on display (`$160`, `EUR 120`) and leave the stored text alone.
- [ ] **[M]** Normalise old prices once: a Settings button (or startup migration) that rounds `150.99` → `150` so the list matches what autofill produces now.
- [ ] **[M]** Fashion cards crop product photos to 16:10 `object-fit: cover` (`styles.css:429-438`). Product shots are usually portrait on white; use `contain` on a neutral background in the fashion space (or default fashion to masonry).
- [ ] **[M]** Size field (`size`, plain text, fashion only) in the form and detail. Most wishlist decisions end at "do they have my size".
- [ ] **[M]** Read `offers.availability` in `pageInfo` (JSON-LD already parsed) and show a "Sold out" badge after a refresh.
- [ ] **[M]** Autofill title cleanup: strip the tail that duplicates the brand or site (`Men's Jacket | Brand - Shop Online` → `Men's Jacket`). `FASHION_SPACE.md` lists messy titles as a known limit; the brand is already guessed, so subtract it.
- [ ] **[L]** Give `guessOption` for types an alias table like `COLOR_ALIASES` already has (`autofill.js:30`): Jacket ← coat, parka, blazer, bomber; Pants ← trousers, jeans, chinos; Shoes ← boots, sneakers, loafers; Knitwear ← sweater, cardigan, jumper. Types currently get no aliases, so `Parka` guesses nothing.
- [ ] **[L]** "Add all N images" in the autofill image picker for product pages (cap 10): front, back, detail shots in one click.
- [ ] **[L]** Seed a few optional fashion tags (Formal, Casual, Workwear, Fall, Gift) offered once in Settings. The fashion library starts with zero tags, so the Tags filter is empty.
- [ ] **[L]** Board total + "cheapest / priciest" line on fashion boards (outfits, gift lists).
- [ ] **[L]** Copy a fashion list as Markdown (`- [Name](url) — Brand — $120`) for pasting into Obsidian or sending to someone.
- [ ] **[M]** Dragging an image from another browser tab drops a URL, not a file, so `receiveImages` ignores it. Detect `text/uri-list` and route it through `/screenshot-url`.
- [ ] **[M]** Offer `og:description` as a note suggestion (UI space), marked "autofilled" like the other fields. `pageInfo` already reads meta tags.
- [ ] **[L]** Crop-before-save: trim a pasted screenshot's browser chrome with a simple rectangle crop in the pending-shots strip.
- [ ] **[H]** "Needs attention" smart filter: no tags, no note, no type, no real screenshot. Real data: 12/12 fashion entries have no tags and 29/30 UI entries have no note, so a triage list would clear a backlog in minutes.
- [ ] **[L]** Right-click context menu on cards (open, favorite, add to board, copy link, delete).
- [ ] **[L]** Daily pick: a single "Revisit this" card on an empty search that changes once a day.
- [ ] **[M]** Per-screenshot captions ("Hero", "Pricing", "Mobile nav") shown in the carousel and lightbox.
- [ ] **[M]** "Copy image" and "Download original" buttons in the lightbox.
- [ ] **[M]** Copy-as-Markdown-link (`[Title](url)`) and "Copy URL" buttons in the detail view.
- [ ] **[M]** Move an entry to the other library (misfiled UI ↔ Fashion): `POST /api/entries/:id/move`, re-registering tags/types with `canon`, uploads are shared so no file moves. Also available as a bulk action.
- [ ] **[L]** Render URLs in notes as links (notes are a plain `textarea`, 10,000 chars).
- [ ] **[L]** Edit the title inline on the detail header (double-click) without opening the full form.
- [ ] **[L]** Copy the palette in one go: `--c1: #...;` CSS variables, Tailwind config snippet, or JSON. Single-swatch copy exists; the whole set doesn't.
- [ ] **[M]** Choose a board's cover image instead of the auto collage.
- [ ] **[L]** Duplicate a board (start the next project from the last one).
- [ ] **[L]** Archive boards: hide finished projects from the picker without deleting.
- [ ] **[L]** Board "contact sheet" export as PDF or one-page HTML: thumbnails, titles, URLs, palettes, notes. Different from FINDINGS' static-HTML share: this one is for printing / attaching to a brief.
- [ ] **[M]** "Delete unused tags" button in Settings (usage is already computed by `tagUsage`).
- [ ] **[L]** Tag colors, shown on pills in cards and the filter.
- [ ] **[L]** Drag one tag onto another in Settings to merge (the multi-select merge exists).
- [ ] **[L]** Reorder types and found-via lists manually instead of alphabetical only.
- [ ] **[L]** Export / import the tag, type and found-via lists as a template file, so a new space or machine starts with your taxonomy.
- [ ] **[L]** Hover-to-scroll on tall screenshots in a card (long landing pages slowly scroll inside the card, Dribbble-style).
- [ ] **[L]** Cap stacked toasts at 3 and collapse repeats, so a bulk failure doesn't paint the screen.
- [ ] **[M]** "Skip to content" link ahead of the 7-item sidebar.
- [ ] **[M]** Announce results: make `#result-count` (`12 of 27`) an `aria-live="polite"` region so filtering is audible.
- [ ] **[M]** Run axe or Lighthouse over both themes and both spaces; fix contrast of muted text and the fashion accent in light mode first.
- [ ] **[L]** Honor `prefers-contrast: more` and `forced-colors` (swatch borders, selected states that rely only on color).
- [ ] **[L]** Return focus to the invoking card when the detail modal or lightbox closes.
- [ ] **[L]** Don't rely on color alone for favorite and selected states; add an icon/shape change.
- [ ] **[L]** Text-scale test at 200% zoom and 18px base font; fix clipped controls.
- [ ] **[L]** 600px thumbnails look soft on hi-DPI masonry; generate a 1200px variant and use `srcset`.
- [ ] **[L]** Skip `extractPalette` for fashion-space uploads (the swatch filter is hidden there), saving CPU and keeping `palette` empty.
- [ ] **[M]** "Export everything": one ZIP with both libraries and all screenshots. Export is per space today, and restore/import will want a single file.
- [ ] **[M]** "Backup now" button plus the last backup time in Settings, so the 7-day rotation is visible and you can force one before a risky bulk edit.
- [ ] **[M]** Restore from a backup in the UI: list `db/backups/` files with entry counts, preview, restore one (after taking a safety copy first).
- [ ] **[M]** Longer backup tail: keep 7 daily plus 4 weekly plus 3 monthly so a problem noticed after a week is still recoverable.
- [ ] **[L]** Move the data directory to a configurable location by default (`$XDG_DATA_HOME/omniview`), so updating or re-cloning the app never touches the library.
- [ ] **[H]** Stop committing personal data. `db/library.json`, `db/fashion.json` and `uploads/*` are tracked (see `git status`: the commit "Update fashion library data and uploads"). If the repo is ever pushed publicly, the wishlist and screenshots leak. Add them to `.gitignore`, `git rm --cached`, and keep a tiny sample dataset for tests/screenshots. Back the data up separately.
- [ ] **[L]** Settings toggle "never fetch pages for me" (disable unfurl and screenshot-url) for a fully offline mode.
- [ ] **[L]** Add a fashion screenshot next to `docs/sidebar-collapsed.png`.
- [ ] **[?]** `omniview` CLI / Hyprland keybind capture: `omniview add <url>` and `omniview shot` (grim + slurp region → POST as a screenshot, or clipboard via `wl-paste`). A ~30-line shell script with `curl -H 'X-Omniview: 1'` gives one-keystroke capture on this machine without a browser extension.
- [ ] **[?]** Searchable text inside screenshots via local OCR (`tesseract.js`), so "pricing", a headline, or a product name finds the design. Stays local, store the text on the entry, show it in the detail view.
- [ ] **[?]** Local vision-model tagging (e.g. via Ollama, optional): suggests tags/type/description from the screenshot. Opt-in, never auto-applied, no cloud.
- [ ] **[?]** Visual similarity search ("find designs that look like this") using image embeddings computed locally.
- [ ] **[?]** Obsidian export: one Markdown note per entry with frontmatter (tags, type, url, price, brand) and the image embedded, for a vault-based workflow.
- [ ] **[?]** Free-form moodboard canvas for a board: drag, resize and overlap cards, then export as PNG.
- [ ] **[?]** Import from a browser bookmarks HTML file or a Pinterest/Are.na export; feeds the batch-add flow.
- [ ] **[?]** Installable PWA (`manifest.webmanifest` + icons) so Omniview opens in its own window and launches from the app menu, paired with the systemd unit already in FINDINGS.
- [ ] **[?]** Cross-links between entries ("related", "alternative to") shown as a small graph or list in the detail view.
- [ ] **[L]** Preserve the current filters in the URL query (`?tag=Minimal&type=Website`) so a filtered view can be bookmarked even before full hash routing (FINDINGS) exists.
- [ ] **[L]** Detect "sale" prices (`highPrice` vs `price`, `priceValidUntil`) and store the original so a "was $200" line is possible.
- [ ] **[L]** Detect multiple colorways (`hasVariant`) and offer the list, instead of choosing only the first variant's offer.
- [ ] **[L]** Entry "priority" (1-3 stars) as an alternative to the single favorite flag, for wishlists with a clear top-3.
- [ ] **[L]** Weekly digest on the empty-search Browse state: "Added this week: 4. Untagged: 12. Dead links: 0."
- [ ] **[H]** Import / restore from export (`[H]` already). Now covers two libraries.
- [ ] **[H]** Batch add from pasted URLs. `FASHION_SPACE.md` says the workflow is "find on phone → Obsidian → add in batches on the laptop". That is exactly this feature.
- [ ] **[H]** Real screenshots via headless Chromium (already `[H]`): highest-impact capture upgrade for the UI space.
- [ ] **[M]** ZIP export error handler: with two libraries a crash during export affects both.
- [ ] **[M]** Entry cards keyboard-reachable: the biggest accessibility gap.
- [ ] **[M]** Self-host fonts: keeps "local only" true and the app usable offline.
- [ ] **[?]** "Never shown together." Still right for browsing; a cross-library search (section 3) is read-only and doesn't mix tags or boards.
