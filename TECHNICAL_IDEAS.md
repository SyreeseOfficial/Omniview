# Technical Ideas

Backlog of non-UI/UX improvements for Omniview: data integrity, security, reliability, performance, testing. Not implemented unless marked done.

## Open

(none — see Done)

## Done

- **Screenshot "clear" button during edit now actually clears it** — `PUT /api/entries/:id` accepts `removeScreenshot: true`, which deletes the stored file and nulls the field. The client sends that flag when the drop-zone's clear button was used, and resets the flag whenever a form is (re)opened or a new file is dropped, so a stale flag from a cancelled edit can't silently nuke an unrelated save.
- **`writeDB()` is atomic and crash-safe** — every write now goes to `library.json.tmp` then `fs.renameSync`s over `library.json`, so a crash mid-write can no longer truncate the file.
- **No more write races** — `readDB()`/`writeDB()` now operate on one in-memory object loaded once at boot, instead of re-reading the file on every request. Two near-simultaneous mutations apply to the same shared object in order; there's no stale disk snapshot for a second write to clobber.
- **Screenshot uploads are validated** — `multer`'s `fileFilter` allowlists `image/png`, `image/jpeg`, `image/webp`, and `image/gif` only, and the stored filename's extension is derived from that allowlist rather than the client-supplied filename — closes the `.svg`-as-stored-XSS path.
- **Automated tests** — `npm test` runs `node --test` (Node's built-in runner, no new dependency) over `test/api.test.js`: entry CRUD, search-by-title, screenshot upload/clear/reject-bad-mimetype, bulk tag/delete, whitespace/duplicate name validation, and board-name trimming, all against a throwaway db/uploads dir so the real library is never touched.
- **Backups before destructive writes** — `writeDB()` copies the current `library.json` to `library.json.bak` before every overwrite, giving a one-step-back recovery file for a bad bulk-delete or buggy client call. (`db/*.bak` and `db/*.tmp` are gitignored.)
- **`readDB()` no longer re-reads disk per request** — same in-memory cache from the write-race fix above; loaded once at startup, kept in sync by `writeDB()`.
- **Whitespace-only names are rejected** — tags/types/found-via creation now trims before the empty check (shared `validateOptionName` helper), and board create/rename trim the name too.
- **Renaming a tag/type/found-via now checks for duplicates** — the same `validateOptionName` helper used on create is now also used on rename, rejecting a case-insensitive collision with any other existing name (renaming a name to itself, case unchanged, is still allowed).
- **Global error handler + crash safety net** — a final `(err, req, res, next)` middleware catches thrown errors and multer errors (bad mimetype, size limit) and returns clean JSON instead of Express's default HTML stack trace; `process.on('uncaughtException'/'unhandledRejection')` logs instead of silently dying.
- **Request + write logging** — every request logs method/path/status/duration on completion, and every `writeDB()` call logs a timestamp with the resulting entry/board counts.
