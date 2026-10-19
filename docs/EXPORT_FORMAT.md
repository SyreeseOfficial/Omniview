# Export format

`GET /api/export?format=json` (and `library.json` / `fashion.json` inside the ZIP) return one library:

```jsonc
{
  "version": 1,            // bumped when the shape changes in a way an importer must handle
  "space": "ui",           // which library this came from
  "entries": [ /* Entry */ ],
  "boards": [ /* Board */ ],
  "tags": ["Minimal"],     // the managed lists, in stored order
  "types": ["Website"],
  "foundVia": ["Dribbble"]
}
```

The trash is never exported.

**Entry**

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `url` | string | http(s) only; ad-click parameters (`utm_*`, `fbclid`, `gclid`, ...) are removed when saving |
| `title`, `note` | string | |
| `type`, `color` | string or null | `type` is one of the library's `types` |
| `style_tags` | string[] | names from the library's `tags` |
| `found_via` | string | from `foundVia`, or empty |
| `favicon` | string or null | |
| `favorite` | boolean | |
| `bought` | boolean | wishlist status; the Fashion library hides bought entries by default |
| `boards` | string[] | board ids |
| `date_added` | ISO date string | |
| `updated_at` | ISO date string | only after the entry has been edited (favourite, bought and board changes do not count) |
| `visited_at` | ISO date string or null | when the entry's site was last opened from Omniview |
| `screenshots` | string[] | file names in `uploads/`; the first is the cover |

The library's extra fields follow: `brand`, `price` and `price_was` in `fashion` (all strings; `price_was` holds the previous price after Refresh price).

**Derived, safe to ignore on import**: `palette` (recomputed from the cover image) and `remote_shots` (which screenshots were fetched from the page rather than uploaded).

Not exported: the trash, and the per-file hashes Omniview keeps to spot duplicate images.

**Board**: `id`, `name`, `description`, `emoji`, `color`, `pinned`, `order[]` (entry ids in manual order), `created`.

The ZIP adds the screenshots under `uploads/`. Thumbnails are not included; they are regenerated on start.
