# Technical Ideas

Backlog of non-UI/UX improvements for Omniview: data integrity, security, reliability, performance, testing. Not implemented unless marked done.

## Open

1. **Screenshot "clear" button during edit is dead code (bug)** — `app.js:1112` sets `entry._removeScreenshot = true` when you clear a screenshot while editing, but nothing ever reads that flag. The submit handler (`app.js:1146-1172`) never sends a removal signal, and the server has no way to clear a screenshot at all. Clicking "clear" looks like it worked, but the old screenshot comes right back when you save.
2. **`writeDB()` isn't atomic or crash-safe** (`server.js:44-46`) — every single mutation does a full `fs.writeFileSync` over the one `library.json` file. A crash or power loss mid-write truncates the file and can lose the *entire* library, not just the field being changed. Fix: write to a temp file, then `fs.renameSync` over the original.
3. **No write serialization — concurrent requests can race** — two near-simultaneous mutations (two bulk actions, or two browser tabs open) both `readDB()` the same old state, then both `writeDB()`; the second write silently drops the first's changes. A simple in-process write queue would fix this.
4. **No screenshot upload validation** (`server.js:50-56`) — multer accepts any file and trusts the client-supplied extension. An `.svg` upload gets stored and is later served statically from `/uploads`; SVG can embed `<script>`, making this a stored-XSS vector since uploads are served same-origin. Restrict to an allowlist of real image mimetypes (png/jpg/webp/gif).
5. **No automated tests** — `package.json` has no `test` script and there isn't a single test file in the repo. Every API/data-mutation path (delete, bulk actions, tag/type rename-and-cascade) is verified by hand only. Even a thin smoke test hitting each endpoint would catch regressions early.
6. **No backup before destructive writes** — Factory Reset and all deletes mutate `library.json` immediately with no server-side safety net. A rolling `library.json.bak` written just before each `writeDB()` would make a bad bulk-delete or buggy client call recoverable.
7. **`readDB()` re-reads and re-parses the whole file on every single request** — harmless today, but it's unneeded I/O for a single-process local server as the library grows. An in-memory copy kept in sync by `writeDB()` removes it cheaply.
8. **Whitespace-only names slip past validation (bug)** — every create endpoint checks `if (!name) return 400`, which a string of just spaces passes. Tags/types/found-via then `.trim()` it afterward and can push an empty `""` entry (`server.js:271-274, 317-320, 358-361`). Board names aren't trimmed at all (`server.js:234`), so `"  My Board  "` is stored with the padding intact.
9. **Renaming a tag/type/found-via skips the duplicate check** — `POST` blocks creating a name that already exists (case-insensitively), but `PUT /api/tags/:name`, `/api/types/:name`, and `/api/found-via/:name` just overwrite with `newName.trim()` and never check the rest of the list (`server.js:289, 335, 376`). Renaming "Flat" to "flat" (or to an existing name) silently creates two entries that collide, breaking the uniqueness the create endpoint otherwise guarantees.
10. **No global error handler** — every route is an unguarded sync function; an unexpected throw (a malformed body, a `readDB()` hitting a file that parses but has the wrong shape) isn't caught anywhere, so Express falls back to its default handler and the client gets a raw stack trace instead of a clean error response. There's also no `process.on('uncaughtException'/'unhandledRejection')` safety net.
11. **No logging beyond the startup line** — the only `console.log` is the boot banner. There's no record of requests, writes, or failures, which makes diagnosing "why did my data change" or "why did this write fail" after the fact essentially impossible.

## Done

(none yet)
