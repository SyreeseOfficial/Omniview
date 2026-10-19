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

**Entry**: `id`, `url`, `title`, `note`, `type` (or null), `color` (or null), `style_tags[]`, `found_via`, `favicon` (or null), `favorite`, `boards[]` (board ids), `date_added`, optional `updated_at`, `screenshots[]` (file names in `uploads/`), plus the library's extra fields (`brand`, `price` in `fashion`).

**Derived, safe to ignore on import**: `screenshot` (always `screenshots[0]`), `palette` (recomputed from the cover image), `remote_shots` (which screenshots were fetched from the page rather than uploaded).

**Board**: `id`, `name`, `description`, `emoji`, `color`, `pinned`, `order[]` (entry ids in manual order), `created`.

The ZIP adds the screenshots under `uploads/`. Thumbnails are not included; they are regenerated on start.
