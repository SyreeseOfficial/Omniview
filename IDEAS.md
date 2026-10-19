# Omniview: Ideas

Brainstormed 2026-10-18 against the current code (both spaces, autofill, Express 5, ES modules). Everything here is **new**: nothing repeats an item already in `FINDINGS.md` (those are cross-referenced at the end where one deserves a higher priority).

Priority: **[H]** do soon · **[M]** worth it · **[L]** nice to have · **[?]** big bet / needs a decision. `[ ]` open, `[x]` done.

**Contents:** 1 Fashion · 2 Capture & autofill · 3 Browse & search · 4 Entry detail · 5 Boards · 6 Tags & lists · 7 Visual polish · 8 Accessibility · 9 Performance · 10 Data safety · 11 Security & privacy · 12 Code, tests & dev · 13 Docs & repo · 14 Big bets · 15 Round 2 · 16 Reprioritise from FINDINGS · 17 Decisions to revisit · 18 Round 3 (new) · 19 Remove or simplify

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

- [ ] **[M]** Fixture-based tests for `pageInfo` against realistic shop markup: Shopify, WooCommerce, Squarespace, `AggregateOffer`, `offers` as array, `priceSpecification` arrays, `hasVariant`. Autofill is the most fragile piece and the most used.
- [ ] **[M]** `// @ts-check` + JSDoc `@typedef Entry` and a `tsc --noEmit` script: type safety without a build step, and catches the `entry.palette` / `style_tags` shape drift that `normalizeEntry` guards by hand.
- [ ] **[M]** Serve shared constants from the server: `MAX_SCREENSHOTS` is duplicated in `entry.js:11` with a "keep in step" comment. A tiny `/api/config` (limits, space defaults) removes the drift risk.
- [ ] **[L]** `engines: { node: ">=20" }` in `package.json` (code uses `Object.hasOwn`, `AbortSignal.timeout`, `??=`); fail early with a clear message on old Node.
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

## 18. Round 3: new improvements

Found by reading the code and counting what the two real libraries actually use (`db/library.json`: 30 entries, `db/fashion.json`: 30 entries). Numbers quoted below come from those files on 2026-10-18.

### Bugs and drift (checked against the code)

- [ ] **[M]** `priceTotal` adds every price as dollars, so `EUR 120` and `$100` total `$220`. Sum only bare/USD prices and append "+ 1 in another currency", or leave non-USD out of the total.
- [ ] **[L]** `priceOf` takes the first number in the text: `2 for $100` sorts as 2 and `from $90 to $120` as 90. Prefer the number next to a currency symbol, fall back to the first.
- [ ] **[L]** `persistFilters` saves the search text too, so reopening the app can show "No entries match your filters" because of a query from last week. Persist the filters, start with an empty search box.
- [ ] **[M]** Validate `date_added` in `normalizeEntry`/`libraryProblems`. A hand-edited bad date gives `Invalid Date` in the sort, the date filter and Stats (all call `new Date()` on it unguarded).
- [ ] **[M]** `libraryProblems` checks board ids but not screenshot files. Entries pointing at files that are not in `uploads/` (the usual result of restoring an old JSON backup) only show up as grey placeholders. Count them at startup and show "3 broken images" in Settings → Storage.
- [ ] **[M]** A corrupt `library.json` is moved aside and Omniview starts **empty**. Fall back to the newest file in `db/backups/` instead and say so in a banner ("Restored from backup 2026-10-17: library.json was unreadable").
- [ ] **[L]** `purgeTrash` runs only at startup and when Settings → Trash is opened, so a server left running for weeks never purges. Run it from the daily `backupDaily` path.
- [ ] **[L]** `docs/EXPORT_FORMAT.md` does not list `pinned`, `bought`, `visited_at` or `price_was`, all of which are in every exported entry. Document them.
- [ ] **[M]** Add a test that fails when an entry field is missing from `docs/EXPORT_FORMAT.md`: create an entry, export, compare keys with the doc's bold field names. It would have caught the line above.
- [ ] **[L]** README API table lacks `/api/trash*`, `/api/visit`, `/api/storage`, `/api/optimize`, `/api/health`, `/api/spaces` and the dry-run `GET /api/cleanup`. A test that compares `app.router` routes with the table keeps it honest.
- [ ] **[L]** README project tree lists 9 modules; `autofill.js`, `lib.js` and `stats.js` are missing, and `test/` is "API tests" though it has four files.
- [ ] **[L]** `package.json` still describes Omniview as a "Personal design reference library" (it holds a wishlist too).
- [ ] **[L]** Three fashion entries are priced 425 on the same shop: probably colourways saved as separate entries. `findDuplicate` can't see it (different URLs). Warn "Looks like a colourway of <entry>" when shop, title stem and price match.

### Capture and autofill

- [ ] **[M]** Read `<link rel="canonical">`/`og:url` in `pageInfo` and offer "Use cleaned link". Better saved URLs, and duplicate detection beyond the Shopify rule.
- [ ] **[M]** Strip `utm_*`, `fbclid`, `gclid` from the URL **when saving**, not only when comparing (`TRACKING_PARAM` only feeds `normalizeUrl`). Saved links currently keep the tracking junk.
- [ ] **[M]** In the image picker, collapse near-identical candidates (same path, different `?width=` or `_300x` suffix), prefer the largest, and skip anything under ~200px (logos, sprites) when choosing the default cover.
- [ ] **[M]** After autofill, say what happened in one line: "Filled name, brand, price, type. Skipped colour (2 matches)". The guesses already know which they skipped.
- [ ] **[M]** Bulk action "Re-run autofill (blanks only)" for selected entries, with a diff before applying. Covers old entries from before autofill improved and entries saved offline.
- [ ] **[L]** Slow unfurl: show "Still trying…" at 3 s with a Cancel (`AbortController`) instead of a silent 8 s wait.
- [ ] **[L]** Dropping a link (from the address bar or a page) anywhere on the window starts a new entry with autofill. Dropped files already work; `text/uri-list` does not.
- [ ] **[L]** Extend the "strip ` | Brand - Shop` title tails" idea (parked for Fashion) to the UI space too: `<title>` often ends in the site name.
- [ ] **[L]** Autofill report per shop: remember which fields came back empty per host (like `omniview-corrections`) and show "bronsonshop.com: colour missing 4/15" in Settings. Two shops are 23 of 30 fashion entries, so one shop-specific rule beats more generic heuristics.
- [ ] **[L]** Rate-limit page fetches to one per second per host. Pasting many links from one shop (the batch-add flow) is exactly what gets an IP blocked.
- [ ] **[L]** Cache `/api/unfurl` answers for ~10 minutes per URL; re-pasting after an edit or pressing Refresh price should not refetch the page.
- [ ] **[L]** The scraper's User-Agent says `Chrome/130.0.0.0`, which ages into a bot signal. Build it from one constant that is easy to bump (or drop the version).

### Browse, search and the wishlist

- [ ] **[L]** Sort "Recently edited" now that `updated_at` exists (FINDINGS asked for it only after that field landed).
- [ ] **[M]** Filter and Group by **shop** (hostname). 23 of 30 fashion entries come from two hosts; "everything from Barbour" is the natural question and brand is only a guess at it.
- [ ] **[L]** Sort by brand A to Z in Fashion.
- [ ] **[M]** Fashion Stats: wishlist total, bought total, average price, price spread, entries per brand. Today the Stats page draws the same cards as UI, and for Fashion "Found via" and "Top tags" say "Nothing yet".
- [ ] **[L]** Hide Stats cards that are empty instead of rendering "Nothing yet." (Fashion: tags 0, found via 0).
- [ ] **[M]** Bulk set **brand**, **colour** and **found via**. Bulk can only tag, untag, set type, board, favourite; a wrong brand guess repeats across a whole shop.
- [ ] **[M]** Brand rename/merge. Brand is free text with autofill suggestions, so `Bronson Mfg.` / `Bronson MFG` variants can still appear; Tags, Types and Found via have merge UI, Brand has none. Inline in the brand filter dropdown is enough.
- [ ] **[M]** Empty result: say which filter is to blame and what dropping it gives ("Remove Shoes → 8 results"). The chips and facet counts already have the numbers.
- [ ] **[L]** "New" dot on entries added since you last opened the app (store one timestamp in `localStorage`).
- [ ] **[L]** Group headings: collapsible, with a subtotal in Fashion ("Dr. Martens · 2 · $270").
- [ ] **[M]** After Refresh price, mark the card "▼ $20" when the price fell and add a bulk "Refresh prices of the visible list" that runs one at a time with a delay. Still manual (the "no background tracking" decision stands), but you stop opening 15 entries one by one.
- [ ] **[L]** Fuzzy search fallback: if an exact search finds nothing, retry with edit distance 1 on title and brand (`barbor` finds Barbour).
- [ ] **[L]** Restore scroll position per library when switching with `G` (switching currently re-renders from the top).

### Detail view and boards

- [ ] **[L]** Show image dimensions and file size under the screenshot ("1440×900 · 312 KB"). Makes the Optimise decision visible per entry.
- [ ] **[L]** Autosave an unsaved detail note to `localStorage` the way the Add form saves drafts; the dirty guard only warns.
- [ ] **[L]** Set `document.title` per view and open entry ("Omniview · Boards", "Wool overcoat · Omniview") so tab switchers and browser history are readable.
- [ ] **[L]** Triage mode for untagged entries: one large screenshot at a time, tag chips on number keys, Space for next. Pairs with the parked "Needs attention" filter.

### Data safety and privacy

- [ ] **[M]** Persist an image hash on the entry when a screenshot is attached. `findDuplicateImage` reads and SHA-256s every screenshot in both libraries on the first upload after each restart (39 MB now, grows with the library).
- [ ] **[L]** Hide the heartbeat's silence: `setInterval(... api.get('/api/health').catch(() => {}))` swallows connection errors, so a stopped server shows nothing until the next click. If the poll stays, show "Omniview stopped. Retry" when it fails (otherwise remove it, section 19).

### Tests and tooling

- [ ] **[M]** Run `node --test --experimental-test-coverage` once and attach the report: uncovered branches are the first candidates to delete (see section 19) or to test.
- [ ] **[L]** Structural test that every `$('id')`/`getElementById('id')` in `public/js` exists in `index.html` and every `data-view` has a `view-*` section. Both pass today (checked); the test keeps them passing as the markup shrinks.
- [ ] **[L]** Test that every non-GET `/api` route rejects a request without `X-Omniview` (walk the router stack). Guards the cross-site protection against a new route being mounted before the check.
- [ ] **[L]** Split `test/api.test.js` (803 lines, 59 tests) by area (entries, lists, boards, spaces, images). `node --test` runs files in parallel and a failure then names its area.
- [ ] **[L]** Switch ad-hoc show/hide to the `hidden` attribute: `index.html` has 45 inline `style="display:none"` and the JS has about 74 `style.display =` writes. One `[hidden]{display:none!important}` rule and `el.hidden = …` removes most of them.
- [ ] **[L]** `CHANGELOG.md` is generated from every commit, including the automatic "Update fashion library data and uploads" ones. Add `--invert-grep --grep='library data and uploads'` to the `changelog` script.
- [ ] **[L]** README: a `curl` example with `X-Omniview: 1` and `X-Space`, for keybind scripts (the header requirement surprises anyone scripting against the API).
- [ ] **[L]** One-page `docs/ARCHITECTURE.md`: add flow (URL → unfurl → guesses → save → screenshots → palette) and who owns what (state in memory, debounced write, spaces via `AsyncLocalStorage`). The app is 7.6k lines now.
- [ ] **[L]** Sidebar items are `<a href="#">` (they navigate in JS and add `#` to the URL). Make them `<button>`s with `aria-current` on the active one.
- [ ] **[L]** `sharp.cache(false)` and `sharp.concurrency(2)` at startup, so uploading ten screenshots at once does not spike memory.

### FINDINGS.md housekeeping (these are already done in the code)

- [ ] **[L]** Close "The first paint uses the wrong theme": the inline script in `<head>` does it.
- [ ] **[L]** Close "Entry cards are not keyboard-reachable" down to "arrow keys inside the grid" (above): cards have `tabIndex=0` and Enter.
- [ ] **[L]** Close the `updated_at` half of "The entry has no `updated_at` or `last_viewed`"; only `last_viewed` is still open, and `visited_at` partly covers it.
- [ ] **[L]** Re-rank "Real screenshots via headless Chromium": 18 of 30 fashion entries use the page's own `og:image`, which for a product photo is the right image. The capture upgrade now only matters for the UI library.
- [ ] **[L]** Still open and still true, in one place: `isMobile = entry.type === 'Mobile App'` at `browse.js` (the UI types are Website and Start Page), Google Fonts still loaded from `index.html`, no CSP/`nosniff` headers.

---

## 19. Remove or simplify

Less is more. Each line says what goes, what it costs to keep, and the evidence. Features built in the last commits (pin, visited, bought) have had no time to be used; the plan is to re-check on **2026-11-18** with `scripts/usage.js` rather than cut on a hunch.

### Delete first (no loss)

- [ ] **[M]** `<link rel="modulepreload">` ×11 in `index.html`. Loopback latency is under 5 ms and the list is already stale (`stats.js` is missing).
- [ ] **[L]** `db/library.json.bak` and the `db/*.bak` line in `.gitignore`: nothing writes `.bak` files any more.
- [ ] **[M]** The derived `screenshot` field ("kept for older clients and exports"). There are no older clients. It is mirrored from `screenshots[0]` in `normalizeEntry` and used about 18 times; read `screenshots[0]` instead, drop it from the file and the export.
- [ ] **[L]** The 14 copies of the caret SVG in `index.html` while `CARET_SVG` exists in `state.js`; one CSS `::after` mask replaces all of them.
- [ ] **[L]** Hide the "Page image" badge in Fashion. 18 of 30 cards have it, and there the page's product photo is the correct image, so the badge is noise.
- [ ] **[L]** The `GET /api/entries` server-side sort. The client sorts everything again; the server already stores entries in order.

### Delete once usage confirms

- [ ] **[M]** `GET /api/health` and the 10-second poll in `main.js`. Every API answer already carries `X-Save-Error`; check it in `api.js` on each response and when the tab regains focus. One endpoint, one timer and one request per tab every 10 s gone. (Or keep it and make it show "server stopped", section 18.)
- [ ] **[M]** Make delete-with-undo use the Trash. `deleteEntriesWithUndo` hides the entries, waits 5 s, and only then sends the delete; closing the tab inside those 5 s silently keeps entries you "deleted", and the failure path reloads the whole list. With Trash in place: delete at once (soft), and Undo calls `POST /api/trash/:id/restore`. Removes the timer, the `undone` flag and the cross-space bookkeeping.
- [ ] **[M]** Factory reset (Danger Zone, typed library name, `/api/reset`, its confirm body, its tests). Trash plus seven backups cover mistakes; a real reset is deleting `db/<library>.json`. Also one less destructive endpoint on localhost.
- [ ] **[M]** "Both libraries" toggle (`filter-both`, `renderAlso`, `alsoCache`, `.also-section`). The two libraries share no vocabulary (websites vs jackets), and the design record says "never shown together".
- [ ] **[M]** Pin (card button, detail button, sort rule, `pinned` field, export). Favourite already means "important" and 0 of 60 entries are pinned. Two flags for one idea.
- [ ] **[L]** "Recent" chip, `omniview-recent` storage and `recordRecent`. Newest sort covers 30 entries, and "recent" is a third meaning of "seen" next to `visited_at` and `updated_at`.
- [ ] **[L]** `/api/optimize` and its button after one more run: the library is already optimised and new uploads are size-capped by the 50 MB limit only. Keep it as `scripts/optimize.js`, out of the server and Settings.
- [ ] **[L]** "Check unused files" button: do the sweep at startup (log the count) and remove the button, the Storage section's three paragraphs and the extra confirm dialog. Orphans only come from interrupted uploads.
- [ ] **[L]** Contrast badge (`contrastRatio`, `contrastLevel`, the AA/AAA label and their tests). Interesting, but nothing in the workflow acts on it.
- [ ] **[L]** "More like this" while the library is under ~50 entries: hide the section; with 30 entries it mostly returns whatever shares a type.
- [ ] **[L]** `TAG_ALIASES` and `similarTag` (stemming and edit-distance for a near-duplicate warning). Keep `suggestTags` (one click, palette based); plain substring matching is enough for 27 tags.
- [ ] **[L]** The custom from/to date range in the date filter (`inAddedRange` custom branch, two date inputs, a test). "This week" and "this month" cover it.
- [ ] **[L]** Compact-density toggle: it only applies to the list layout, and the card-size slider already covers density in the other two.
- [ ] **[L]** Per-library accent colour picker and its two storage keys. Keep the fixed violet and the fixed Fashion accent in CSS; the head script gets shorter too.
- [ ] **[L]** The "System" theme option: Dark/Light from the sidebar toggle is enough, and `matchMedia` branches in the head script and `setupTheme` go away.
- [ ] **[L]** "Export JSON" button: the ZIP contains the same JSON. One export button; keep `?format=json` for scripts.

### Fewer defaults, fewer fields on screen

- [ ] **[H]** Stop seeding 26 default style tags. 17 of the 27 tags in the UI library have never been used (Brutalist, Glassmorphism, Neumorphism, Retro, Futuristic and 12 more), while the two real favourites ("Clean" 9, "Video Scroll" 6) were added by hand. `canon()` already creates tags on first use. Fashion starts at 0 tags and works fine.
- [ ] **[L]** Same for fashion types: Pants, Knitwear, Hat, Bag and Accessory have 0 entries. Ship 3 to 4 defaults and let `canon()` add the rest.
- [ ] **[M]** Make Found via optional per library. In Fashion it is empty on 30 of 30 entries but still has a filter dropdown, a form field, a Settings list, a Stats card and an autofill guess. A per-library `features` entry in `SPACES` (`foundVia: false`) hides all five.
- [ ] **[M]** Hide Boards in Fashion until one exists (0 boards, 0 entries on one): the nav item, board filter, picker and form chips are empty chrome there.
- [ ] **[M]** Add form: keep Screenshot, URL, Title, Type, Tags, and put Note, Boards, Found via and Favourite under "More details". Notes are filled on 1 of 30 UI entries and 0 of 30 in Fashion.
- [ ] **[M]** Detail view: show empty optional fields as "+ Add note", "+ Add to board" until used, instead of 13 permanent inputs.
- [ ] **[L]** Card hover overlay has five icon buttons (open, copy URL, board, pin, favourite). Keep open and favourite; board, copy and pin live in the detail view. Fewer targets over the picture.
- [ ] **[L]** Skeleton cards, View Transitions (`withTransition`) and the toast countdown bar: pure polish on a local app that loads in tens of milliseconds. Cut any that show a frame drop.

### Whole screens to reconsider

- [ ] **[M]** Favourites as a separate screen. It renders `state.entries.filter(favorite)` into its own grid (`renderFavorites`, `view-favorites`, `fav-grid`, nav item, `F` key) while Browse has a ♥ Favorites chip: two routes to one list. Keep the chip, delete the screen.
- [ ] **[L]** Keyboard Shortcuts as a full sidebar screen for 14 lines. Make `?` open a small dialog (the confirm modal exists) and delete `view-shortcuts` plus the nav item.
- [ ] **[M]** Cut single-letter shortcuts to `N` (new), `/` (search), `G` (switch library) and `?`. `B O F S T R` navigate to screens one click away, and the "Single-key shortcuts" toggle in Settings exists only because they misfire.
- [ ] **[?]** The Stats page. For 30 entries it shows one or two bars, an empty "Found via" in Fashion and a colour strip. Either remove it (`stats.js`, `libraryStats`, CSS, nav item, `T`, tests) and keep the entry count in the sidebar footer, or make it earn its place with the Fashion numbers in section 18.
- [ ] **[L]** `SPACES.fields` promises "any extra string field" but the forms only render `brand` and `price`, and the README's "Recipes" example would store data it cannot edit. Either render `fields` generically or trim the README claim to what works.

### Repo hygiene

- [ ] **[H]** Already parked, now measured: `.git` is 32 MB because screenshots are committed (61 tracked files under `uploads/`, plus both libraries) and the "Update fashion library data and uploads" commits keep adding to it. History cannot shrink without a rewrite, so stop committing data before the next one.
- [ ] **[L]** Delete generated `CHANGELOG.md` from the repo and print it on demand (`npm run changelog`), or keep it but filter the data commits; today it is a copy of `git log`.
- [ ] **[L]** Drop `docs/sidebar-collapsed.png` from the README in favour of one real Browse screenshot per library; the collapsed sidebar is the least informative picture of the app.

---

## Completed

- [x] **[H]** Sort by price (low→high, high→low). The sort menu only has Newest / Oldest / A–Z / By Type (`browse.js` `SORT_OPTIONS`). Parse the number out of the text at sort time; no schema change needed to start.
- [x] **[L]** `GET /api/health` (save error for the banner). Uptime and per-space counts were not added.
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
- [x] **[H]** Unit tests for `public/js/autofill.js`. It is pure (no DOM), `node --test` can import it, and it has no tests (`test/` only has `api.test.js`). Cases: brand known-vs-page, per-host prior brand, "Red Wing" scrubbing, `shirt jacket` ambiguity, `EUR 120` currency.
- [x] **[M]** Collapse the three near-identical tags/types/found-via route groups (`server.js:752-892`, ~140 lines) into one `managedList(path, key, onRename, onDelete)` registration.
- [x] **[M]** Split `server.js` (1,009 lines) into modules, mirroring the client: `store.js` (spaces, load/save/backup), `images.js`, `unfurl.js`, `routes/*.js`. The test suite makes it a safe refactor.
- [x] **[H]** `uuid` dependency: `crypto.randomUUID()` does the same and `server.js` already requires `crypto`. Two call sites, one fewer package.
- [x] **[H]** `compression` dependency and middleware. The server only listens on `127.0.0.1`; gzip over loopback costs CPU and saves nothing.

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
- [ ] **[M]** Sort "Least recently opened" and a filter chip "Never opened". `visited_at` is stored but nothing reads it except the card badge.
- [ ] **[M]** Arrow-key movement inside the grid (roving tabindex). Cards are `tabIndex=0` and Enter opens them, but 30 to 300 tab stops is a lot; Tab should enter the grid once and arrows should move.
- [ ] **[L]** Wishlist review: a filter "Added over 6 months ago, not bought" with bulk delete. Wishlists rot the way inspiration libraries do.
- [ ] **[L]** Per-board budget: set an amount, show "$340 of $500" next to the running total (outfits, gift lists).
- [ ] **[L]** Price operators in the search box (`price<200`, `under 200`) alongside the `tag:`/`type:` operators already in FINDINGS. Cheaper than a dedicated price filter UI.
- [ ] **[L]** Fashion CSV export (name, brand, price, url, type) for a spreadsheet. Parked Markdown copy covers pasting; CSV covers sorting by price in Sheets.
- [ ] **[L]** Suggest tags from host history in the UI space ("entries from dribbble.com usually get Playful, Clean"), the same per-host idea as `guessBrand`. Fashion has no tags, so UI only.
- [ ] **[?]** Inbox folder: watch a screenshots directory (e.g. `~/Pictures`) and create "needs details" UI entries from new files. Decide if this beats the parked `omniview shot` keybind.
- [ ] **[H]** Favicons are hot-linked. `faviconImg` sets `img.src` to each shop's own icon URL, so every time Browse renders, your browser contacts every shop on your wishlist. That contradicts "Local only". Download the favicon once on save (32px, via `sharp`, into `uploads/favicons/`) and serve it locally, or drop favicons (see section 19).
- [ ] **[M]** `npm run backup`: one script that writes `db/*.json` plus `uploads/` (without `thumbs/`) to a dated tar in a folder you choose. The daily rotation protects the JSON only; uploads are in no backup (FINDINGS has the trash side of this).
- [ ] **[L]** `scripts/usage.js` that prints how many entries use each field (note, tags, boards, pinned, visited, several screenshots, brand, price). The cut list in section 19 came from a one-off of this; keep it to decide with data next time.
- [ ] **[L]** Random button and the `R` key, if neither is used in a month. At 30 entries the grid is the shuffle.
- [ ] **[L]** The `visited_at` badge and `/api/visit` if "Open all links" is not used on a board. 0 of 60 entries have it today.
- [ ] **[L]** Board decoration: colour dot *and* emoji *and* pin-to-sidebar *and* description *and* manual order. None of the 3 boards uses any of them. Keep emoji and manual order; cut colour and pin first.


