# UI/UX Ideas

Backlog of UI/UX improvements for Omniview. Not implemented unless marked done.

## Open

1. **`alert()` for errors** (`app.js:1444` and friends) — blocks the whole page, looks broken next to the rest of the polished UI. Replace with a small toast. Highest impact for lowest effort.
2. **No delete undo** — delete modal confirms, but a wrong click still loses data permanently with no recovery window. A 5-second "Undo" toast after delete would fix this cheaply.
3. **No toast/feedback layer** — success is silent (modal just closes); errors fall back to `alert()` (see #1). A shared toast component would cover both #1 and #2.
4. **Save buttons don't disable during the async request** — `entry-form` submit and `detail-save` fire `await api.put/post` but stay clickable the whole time. Double-click (or a slow screenshot upload) can submit twice and create duplicate entries. Small diff: disable button + restore in a `finally`.
5. **Modals lack `role="dialog"` / `aria-modal`, focus trap, and focus-return on close** — Tab currently leaks focus out to the page behind an open modal, and keyboard-only users lose their place when a modal closes.
6. **Sidebar doesn't auto-collapse on mobile** — only one breakpoint (860px) hides table columns; the fixed 220px sidebar still eats screen on phone-width. Now that manual collapse exists, auto-collapsing below ~700px is a small CSS add.
7. **No command palette (Cmd/Ctrl+K)** — jump straight to an entry by title/URL instead of browsing. Worth it only once the library gets large; otherwise premature (YAGNI).
8. **Board cards show no visual preview** — just a name and entry count (`renderBoards`, `app.js:897`). This is a visual reference tool; a 2×2 thumbnail collage pulled from the board's entries would make boards recognizable at a glance instead of reading names.
9. **Filters reset on reload** — only theme and layout (gallery/list) persist across reloads; active search text, tag filters, and type filter are lost every refresh.
10. **No favicon shown for entries** — a small site icon next to the URL (card and detail view) would help tell similar-looking screenshots apart at a glance. Needs a source for the icon (extract during screenshot capture, or an external favicon service) — flag as a design decision, not a free add.

## Done

- **Collapsible sidebar** — icon-only mode via edge toggle button, animated, state persisted.
- **Keyboard shortcuts** — global nav (`/`, `N`, `B`, `O`, `F`, `S`, `?`), `Esc` to close modals, `Ctrl`/`Cmd`+`Enter` to save, plus a Shortcuts tab listing them all.
- **Sort control in Browse** — sort dropdown in the filter bar (Newest, Oldest, A–Z, By Type).
- **Quick "open site" action on the grid card** — external-link icon in the card's hover overlay next to the favorite heart.
- **Loading state on initial page load** — spinner shown in the grid container while `loadAll()` is in flight.
- **Search matches the entry title** — `applyFilters` now checks `title` alongside `url`, `note`, and `style_tags`.
- **Unsaved-changes warning on the Add/Edit form** — a snapshot taken when the form loads is compared against on every nav attempt; a dirty form prompts "Discard unsaved changes?" before switching tabs, and `beforeunload` catches closing the tab/browser too.
