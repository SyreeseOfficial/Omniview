# Omniview

A personal design reference tool for collecting and browsing inspiring web and mobile designs.

![Omniview's collapsed sidebar](docs/sidebar-collapsed.png)

## What it does

Omniview centralizes your scattered design inspiration into one searchable local library. Screenshot a website or mobile app you love, add it to your collection with metadata and style tags, then browse and filter your growing library whenever you need design references.

## Features

- **Capture & Store**: Paste a URL and Omniview fills in the title, `og:image`, favicon, and color for you. Paste or drop screenshots anywhere in the window; keep several per entry.
- **Tag by Style**: Organize designs by visual style, pattern, or aesthetic; merge and bulk-delete tags in Settings
- **Browse & Search**: Gallery, masonry, or list layout; filter by type, tag, board, shop, favorite, or color; a typo in the search still finds things (`barbor` finds Barbour); an empty result says which filter to drop
- **Project Boards**: Group designs into project-specific boards; drag a card onto another board to add it
- **Duplicate detection**: Saving a page you already have (ignoring `www.`, `http`/`https`, trailing slashes, and tracking parameters) offers "Open it" or "Add anyway"
- **Stats**: entries added per month, top tags, found-via sources and types, and (UI library) the colors your favorites use most. Fashion shows what the wishlist costs: still wanted, bought, average and spread of prices, items per brand.
- **Libraries**: a sidebar toggle (or `G`) switches between UI inspiration and a Fashion wishlist (more are one config entry, see [Adding a library](#adding-a-library)). Each has its own entries, tags, boards, types, and found-via list. Fashion entries also have a `brand` and a typed-in `price`, and no color filter.
- **Fashion autofill**: pasting a product URL fills the name, brand, price (whole dollars), type, and color from the page's structured data, and offers its other images as screenshots. It says what it filled and what it skipped, offers the page's own cleaned link, and warns when the item looks like another colourway you already saved. "Re-run autofill" fills the blanks of old entries after a diff you approve. See [How autofill decides](#how-autofill-decides).
- **Wishlist tools**: bulk set brand, colour and found via; rename or merge a brand from the brand filter; "Refresh prices" re-reads the visible list one item at a time (nothing runs in the background) and marks cards whose price fell.
- **Local Only**: Everything runs on your machine—no cloud, no accounts, no sharing. The only outgoing requests are the page fetches you trigger by entering a URL.

## Getting Started

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open `http://localhost:3737` in your browser

Press `?` in the app for the keyboard shortcuts (`N` new entry, `/` search, `G` switch library).

Try it without touching your own library: `npm run seed` writes 30 sample entries with generated screenshots into `demo/` (git-ignored), and `npm run demo` serves them on port 3738.

## How it works

- **Frontend**: Browser-based interface (plain ES modules in `public/js/`, no build step)
- **Backend**: Express 5 server with file upload and storage; thumbnails and color palettes via [sharp](https://sharp.pixelplumbing.com/)
- **Database**: Local JSON libraries (`db/library.json` for UI, `db/fashion.json` for Fashion), kept in memory and saved with a short debounce. The first write of each day also saves a copy of each to `db/backups/` (last 7 kept). Uploads are shared between the two.

## How autofill decides

Pasting a URL runs `GET /api/unfurl` (the server fetches the page, at most one request per second per shop; a 403/429 is retried once with a browser User-Agent, and "Just a moment…"-style bot-wall pages are reported instead of filled in; answers are kept for 10 minutes). Nothing is auto-saved; every filled field is marked and you can overwrite it. A fetch that takes longer than 3 seconds shows "Still trying…" with a Cancel link. Links dropped on the window start a new entry the same way.

| Field | Where it comes from |
| --- | --- |
| Title | `og:title`, then `twitter:title`, then `<title>`. In the UI library a trailing site name (`Pricing | Stripe`) is dropped |
| Images | `og:image` and the product's JSON-LD `image`, up to 8. The same picture at several sizes (`_300x`, `?width=`) collapses to the largest, and logos under ~200px are not picked as the cover; the first is queued as a screenshot, click the others to add them |
| Link | `<link rel="canonical">` or `og:url`, offered as "Use cleaned link" when it differs. Ad-click parameters (`utm_*`, `fbclid`, `gclid`, ...) are removed from every saved URL |
| Brand (Fashion) | A brand already in your library that matches the page's brand or site name; else the brand you used on earlier entries from the same shop; else the page's own |
| Price (Fashion) | JSON-LD `offers` (or `og:price:amount` / `product:price:amount`), rounded to whole dollars: `$49.99` becomes `50`. A non-USD currency is kept as a prefix (`EUR 120`) |
| Type, Color (Fashion) | The one option from your list found in the product's JSON-LD category/color, then the page title, then the URL path (the brand is removed first, so "Red Wing" isn't read as red). A text that names two options ("shirt jacket") is skipped, not guessed |
| Found via | Guessed from the host (Pinterest, Dribbble, Instagram, Reddit) against your own list |

If you change Type or Color after autofill, that correction is remembered for that shop and applied to the next matching guess. The UI space also takes the page's `theme-color`. The rules live in `public/js/autofill.js` (guesses) and `pageInfo` in `server/unfurl.js` (page parsing). Settings → Autofill report lists, per shop, which fields keep coming back empty.

## Where is my data?

Everything is plain files in the project folder (or wherever `OMNIVIEW_DB_PATH` / `OMNIVIEW_UPLOADS_DIR` point):

| Path | What |
| --- | --- |
| `db/library.json`, `db/fashion.json` | The two libraries: entries, boards, tags, types, and the trash |
| `db/backups/` | One copy of each library per day, taken before that day's first write; the last 7 are kept. If a library file is unreadable at start, the newest backup is restored and a banner says so (the damaged file is kept next to it as `.corrupt-<time>`) |
| `uploads/` | Screenshots as uploaded (EXIF is stripped from new uploads) |
| `uploads/thumbs/` | Generated thumbnails; safe to delete, they are rebuilt on start |
| `db/.lock` | Written while the server runs so a second copy can't corrupt the data |

**Back up** by copying `db/*.json` and `uploads/` (skip `uploads/thumbs/` and `db/.lock`) while the server is stopped, or take a ZIP from Settings → Export / Backup (one per library; there is no import yet). Settings → Storage counts entries whose screenshot file is missing from `uploads/`.
**Move to another machine**: install and clone as usual, stop the server on both, copy those same files into the new project folder (or set the two environment variables to the copied locations), and start it.

## Project Structure

```
├── public/           # Frontend
│   ├── index.html
│   ├── styles.css
│   └── js/           # ES modules: main (boot, nav, shortcuts), state, api, browse, entry (add form + detail),
│                     #   boards, options, settings, modals, stats, triage, and the DOM-free helpers lib + autofill
├── server.js         # Express app: guards, static files, error handler, start
├── server/           # store (libraries, saving, backups, trash), images, unfurl, validate, types (JSDoc)
│   └── routes/       #   entries, trash, boards, lists (tags/types/found-via), data (export, storage, cleanup, optimise)
├── db/               # library.json, fashion.json (+ backups/)
├── uploads/          # Screenshots (+ thumbs/, generated)
├── test/             # api, storage, pageinfo, autofill, lib and innerHTML tests (npm test)
├── e2e/              # optional browser smoke test (npm run e2e, needs Playwright)
├── scripts/          # seed.js: sample data for demos
└── docs/             # README images, EXPORT_FORMAT.md, FASHION_SPACE.md (design record)
```

Checks: `npm test` (node's runner), `npm run lint` (ESLint: unused variables, undefined globals, `==`), `npm run typecheck` (`tsc` over the server using JSDoc types, no build step). CI runs all three. Needs Node 20 or newer.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3737` | Port to listen on (always bound to `127.0.0.1`) |
| `OMNIVIEW_DB_PATH` | `db/library.json` | UI library file (`fashion.json` is saved next to it) |
| `OMNIVIEW_UPLOADS_DIR` | `uploads/` | Screenshot folder |

## Adding a library

Libraries live in the `SPACES` table in `server/store.js`. One entry is all it takes; the switcher, `G`, the API and storage pick it up:

```js
recipes: { label: 'Recipes', file: path.join(path.dirname(DB_PATH), 'recipes.json'), defaults: { entries: [], trash: [], boards: [], tags: [], types: ['Dinner', 'Baking'], foundVia: [] }, fields: { servings: 20 } },
```

`fields` are extra string fields on each entry (`{ name: maxLength }`); the server stores them but the forms only render `brand`/`price` today. `features: { foundVia: false }` hides the Found via filter, field, list and stats card for a library that does not use them. A new library gets the generic UI: no palette swatches and no Fashion fields.

## API

JSON over HTTP on the same origin. Request bodies are capped at 100 kb (bulk: at most 5,000 ids). Every non-`GET` request must send `X-Omniview: 1`, and the `Host`/`Origin` must be local; this stops other websites from calling the API through your browser.

Every `/api` call acts on one library: send `X-Space: <name>` (`GET /api/spaces` lists them; or `?space=` for plain links such as exports). No header means `ui`; anything else is a `400`. A library's extra fields (`brand` and `price` for `fashion`) are only read and stored in that library.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/spaces`, `GET /api/config` | The libraries (name, label, extra fields, `features`, and a `notice` when one was restored from a backup) / limits the browser shares (`maxScreenshots`) |
| `GET /api/entries`, `GET /api/entries/:id` | List (stored order; the browser sorts) / fetch |
| `POST /api/entries` | Create; `409` with the existing entry if the URL is already saved, unless `force: true` |
| `PUT /api/entries/:id`, `DELETE /api/entries/:id` | Update / move to the trash |
| `POST /api/entries/bulk` | `{ids, action}`: `tag`, `untag`, `setType`, `setBrand`, `setColor`, `setFoundVia`, `addToBoard`, `removeFromBoard`, `favorite` (needs a boolean `value`), `delete`. Answers `{ok, updated}`; ids that match nothing change nothing |
| `POST /api/visit` | `{ids}`: stamp entries whose site was opened (`visited_at`) |
| `POST /api/entries/:id/screenshot` | Upload a screenshot (multipart field `screenshot`; max 10 per entry) |
| `POST /api/entries/:id/screenshot-url` | Download an image URL as a screenshot |
| `DELETE /api/entries/:id/screenshots/:file` | Remove one screenshot |
| `GET /api/unfurl?url=` | Title, images, favicon, canonical link, price, brand and the rest of what a page offers |
| `GET /api/duplicate?url=` | Is this URL already saved? With `title` and `price` it also reports a likely `colourway` |
| `GET /api/boards`, `POST /api/boards` | List / create boards |
| `PUT /api/boards/:id`, `DELETE /api/boards/:id` | Update / delete a board |
| `PUT /api/boards/order`, `PUT /api/boards/:id/order` | Order of the boards / of the entries inside one board |
| `GET /api/tags`, `GET /api/types`, `GET /api/found-via` | The managed lists |
| `POST /api/tags`, `POST /api/types`, `POST /api/found-via` | Add an option |
| `PUT /api/tags/:name`, `PUT /api/types/:name`, `PUT /api/found-via/:name` | Rename (entries follow) |
| `DELETE /api/tags/:name`, `DELETE /api/types/:name`, `DELETE /api/found-via/:name` | Delete (entries lose it) |
| `POST /api/tags/merge`, `POST /api/tags/bulk-delete` | Merge or delete several tags |
| `PUT /api/brands/:name` | Rename a brand on every entry; an existing name merges them (Fashion) |
| `GET /api/trash`, `DELETE /api/trash` | Deleted entries (purged after 30 days) / empty the trash |
| `POST /api/trash/:id/restore`, `DELETE /api/trash/:id` | Restore / delete one for good |
| `GET /api/export?format=json\|zip` | Export one library (ZIP includes screenshots); any other format is a `400`. Shape: [docs/EXPORT_FORMAT.md](docs/EXPORT_FORMAT.md) |
| `GET /api/storage` | Entry counts (and missing screenshot files) per library, sizes of uploads, thumbnails and backups |
| `GET /api/cleanup`, `POST /api/cleanup` | Count / delete upload files no entry in either library references |
| `POST /api/optimize` | Re-save PNG/JPEG/WEBP originals as WebP, at most 2400px |

## Single-User Design

Omniview is built for one person on one machine. No multi-user features, no authentication, no deployment—just a personal tool that runs when you need it.

---

## License

Personal project, shared for reading and inspiration. No license is granted for reuse or redistribution; ask first.

`npm run changelog` prints the history (`git log` without the automatic data commits). [docs/FASHION_SPACE.md](docs/FASHION_SPACE.md) for how the Fashion space was designed.

Built with Node.js & Express
