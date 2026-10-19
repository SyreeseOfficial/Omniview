# Omniview

A personal design reference tool for collecting and browsing inspiring web and mobile designs.

![Omniview's collapsed sidebar](docs/sidebar-collapsed.png)

## What it does

Omniview centralizes your scattered design inspiration into one searchable local library. Screenshot a website or mobile app you love, add it to your collection with metadata and style tags, then browse and filter your growing library whenever you need design references.

## Features

- **Capture & Store**: Paste a URL and Omniview fills in the title, `og:image`, favicon, and color for you. Paste or drop screenshots anywhere in the window; keep several per entry.
- **Tag by Style**: Organize designs by visual style, pattern, or aesthetic; merge and bulk-delete tags in Settings
- **Browse & Search**: Gallery, masonry, or list layout; filter by type, tag, board, favorite, or dominant color swatch
- **Project Boards**: Group designs into project-specific boards; drag a card onto another board to add it
- **Duplicate detection**: Saving a page you already have (ignoring `www.`, `http`/`https`, trailing slashes, and tracking parameters) offers "Open it" or "Add anyway"
- **Two libraries**: a sidebar toggle (or `G`) switches between UI inspiration and a Fashion wishlist. Each has its own entries, tags, boards, types, and found-via list. Fashion entries also have a `brand` and a typed-in `price`, and no color filter.
- **Fashion autofill**: pasting a product URL fills the name, brand, price (whole dollars), type, and color from the page's structured data, and offers its other images as screenshots. See [How autofill decides](#how-autofill-decides).
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

Press `?` in the app for the keyboard shortcuts.

## How it works

- **Frontend**: Browser-based interface (plain ES modules in `public/js/`, no build step)
- **Backend**: Express 5 server with file upload and storage; thumbnails and color palettes via [sharp](https://sharp.pixelplumbing.com/)
- **Database**: Local JSON libraries (`db/library.json` for UI, `db/fashion.json` for Fashion), kept in memory and saved with a short debounce. The first write of each day also saves a copy of each to `db/backups/` (last 7 kept). Uploads are shared between the two.

## How autofill decides

Pasting a URL runs `GET /api/unfurl` (the server fetches the page; a 403/429 is retried once with a browser User-Agent, and "Just a moment…"-style bot-wall pages are reported instead of filled in). Nothing is auto-saved; every filled field is marked and you can overwrite it.

| Field | Where it comes from |
| --- | --- |
| Title | `og:title`, then `twitter:title`, then `<title>` |
| Images | `og:image` and the product's JSON-LD `image`, up to 8 (the first is queued as a screenshot; click the others to add them) |
| Brand (Fashion) | A brand already in your library that matches the page's brand or site name; else the brand you used on earlier entries from the same shop; else the page's own |
| Price (Fashion) | JSON-LD `offers` (or `og:price:amount` / `product:price:amount`), rounded to whole dollars: `$49.99` becomes `50`. A non-USD currency is kept as a prefix (`EUR 120`) |
| Type, Color (Fashion) | The one option from your list found in the product's JSON-LD category/color, then the page title, then the URL path (the brand is removed first, so "Red Wing" isn't read as red). A text that names two options ("shirt jacket") is skipped, not guessed |
| Found via | Guessed from the host (Pinterest, Dribbble, Instagram, Reddit) against your own list |

If you change Type or Color after autofill, that correction is remembered for that shop and applied to the next matching guess. The UI space also takes the page's `theme-color`. The rules live in `public/js/autofill.js` (guesses) and `pageInfo` in `server.js` (page parsing).

## Where is my data?

Everything is plain files in the project folder (or wherever `OMNIVIEW_DB_PATH` / `OMNIVIEW_UPLOADS_DIR` point):

| Path | What |
| --- | --- |
| `db/library.json`, `db/fashion.json` | The two libraries: entries, boards, tags, types, and the trash |
| `db/backups/` | One copy of each library per day, taken before that day's first write; the last 7 are kept |
| `uploads/` | Screenshots as uploaded (EXIF is stripped from new uploads) |
| `uploads/thumbs/` | Generated thumbnails; safe to delete, they are rebuilt on start |
| `db/.lock` | Written while the server runs so a second copy can't corrupt the data |

**Back up** by copying `db/*.json` and `uploads/` (skip `uploads/thumbs/` and `db/.lock`) while the server is stopped, or take a ZIP from Settings → Export / Backup (one per library; there is no import yet).
**Move to another machine**: install and clone as usual, stop the server on both, copy those same files into the new project folder (or set the two environment variables to the copied locations), and start it.

## Project Structure

```
├── public/           # Frontend
│   ├── index.html
│   ├── styles.css
│   └── js/           # ES modules: main (boot, nav, shortcuts), state, api, browse,
│                     #   entry (add form + detail), boards, options, settings, modals
├── db/               # library.json, fashion.json (+ backups/)
├── uploads/          # Screenshots (+ thumbs/, generated)
├── test/             # API tests (npm test)
├── docs/             # README images, FASHION_SPACE.md (design record)
└── server.js         # Express server
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3737` | Port to listen on (always bound to `127.0.0.1`) |
| `OMNIVIEW_DB_PATH` | `db/library.json` | UI library file (`fashion.json` is saved next to it) |
| `OMNIVIEW_UPLOADS_DIR` | `uploads/` | Screenshot folder |

## API

JSON over HTTP on the same origin. Request bodies are capped at 100 kb (bulk: at most 5,000 ids). Every non-`GET` request must send `X-Omniview: 1`, and the `Host`/`Origin` must be local; this stops other websites from calling the API through your browser.

Every `/api` call acts on one library: send `X-Space: ui|fashion` (or `?space=` for plain links such as exports). No header means `ui`; anything else is a `400`. `price` and `brand` are only read and stored in the `fashion` space.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/entries`, `GET /api/entries/:id` | List (newest first) / fetch |
| `POST /api/entries` | Create; `409` with the existing entry if the URL is already saved, unless `force: true` |
| `PUT /api/entries/:id`, `DELETE /api/entries/:id` | Update / delete |
| `POST /api/entries/bulk` | `{ids, action}`: `tag`, `untag`, `setType`, `addToBoard`, `removeFromBoard`, `favorite`, `delete` |
| `POST /api/entries/:id/screenshot` | Upload a screenshot (multipart field `screenshot`; max 10 per entry) |
| `POST /api/entries/:id/screenshot-url` | Download an image URL as a screenshot |
| `DELETE /api/entries/:id/screenshots/:file` | Remove one screenshot |
| `GET /api/unfurl?url=` | Title, `og:image`, favicon, and theme color of a page |
| `GET /api/duplicate?url=` | Is this URL already saved? |
| `/api/boards`, `/api/tags`, `/api/types`, `/api/found-via` | Managed lists (create, rename, delete) |
| `POST /api/tags/merge`, `POST /api/tags/bulk-delete` | Merge or delete several tags |
| `GET /api/export?format=json\|zip` | Export one library (ZIP includes screenshots) |
| `POST /api/cleanup` | Delete upload files no entry in either library references |
| `POST /api/reset` | Wipe one library; requires `{"confirm":"reset"}` |

## Single-User Design

Omniview is built for one person on one machine. No multi-user features, no authentication, no deployment—just a personal tool that runs when you need it.

---

## License

Personal project, shared for reading and inspiration. No license is granted for reuse or redistribution; ask first.

See [CHANGELOG.md](CHANGELOG.md) for history and [docs/FASHION_SPACE.md](docs/FASHION_SPACE.md) for how the Fashion space was designed.

Built with Node.js & Express
