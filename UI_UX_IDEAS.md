# UI/UX Ideas

Backlog of UI/UX improvements for Omniview. Not implemented unless marked done.

## Open

1. **Save buttons don't disable during the async request** — `entry-form` submit and `detail-save` fire `await api.put/post` but stay clickable the whole time. Double-click (or a slow screenshot upload) can submit twice and create duplicate entries. Small diff: disable button + restore in a `finally`.
2. **Sidebar doesn't auto-collapse on mobile** — only one breakpoint (860px) hides table columns; the fixed 220px sidebar still eats screen on phone-width. Now that manual collapse exists, auto-collapsing below ~700px is a small CSS add.
3. **No command palette (Cmd/Ctrl+K)** — jump straight to an entry by title/URL instead of browsing. Worth it only once the library gets large; otherwise premature (YAGNI).
4. **No favicon shown for entries** — a small site icon next to the URL (card and detail view) would help tell similar-looking screenshots apart at a glance. Needs a source for the icon (extract during screenshot capture, or an external favicon service) — flag as a design decision, not a free add.

## Done

- **Styled prompt modal replaces `prompt()`** — new board, rename board, and "+ Add New" on the Type/Found-via/Tag dropdowns now use a small reusable text-input modal (same shape as the confirm modal, with a labeled input) instead of the browser's native `prompt()`. Nests correctly with the Escape-key stack (checked before the detail modal underneath it, same fix as confirm).
- **Search placeholder updated** — now reads "Search by title, URL, tag, or note…", matching what `applyFilters` actually checks.
- **Detail modal adapts to narrow viewports** — below 700px, `.detail-layout` stacks the screenshot above the fields instead of squeezing a fixed 55/45 row.
- **"Remove from board" action on board cards** — a ✕ overlay button (mirroring the existing fav/open-site buttons) appears on each card while viewing a board, calling a new `removeEntryFromBoard` that patches the entry's `boards` list via the existing `PUT /api/entries/:id`.
- **Keyboard navigation in combo/tag dropdowns** — `renderComboList`/`renderTagDropdown` now tag rows `role="option"` inside a `role="listbox"`, and Up/Down moves a `.focused` highlight (Enter activates it) via a shared `navigateDropdown` helper.
- **Shift-click range select in bulk mode** — shift-clicking a card/row selects every entry between it and the last-clicked one (anchor tracked in `state.selectAnchorId`), the same pattern as Photos-style pickers.
- **Toast component with success/error/undo-action support** — replaces the two remaining `alert()` calls and gives saves a success toast instead of silence.
- **5-second "Undo" toast on delete** (single and bulk) — the entry is removed from view immediately, but the server delete (and screenshot cleanup) is deferred until the toast's window elapses with no Undo click.
- **Modal `role="dialog"`/`aria-modal`, focus trap, and focus-return** — applied to the detail, board-picker, and confirm modals via a shared open/close helper with a nesting-aware stack (confirm can open on top of detail). Also fixed an Escape-key ordering bug this surfaced: Escape now closes the topmost (confirm) modal first instead of the one underneath it.
- **Board card thumbnail collage** — 2×2 grid of up to 4 of the board's entry screenshots instead of just a name and count.
- **Filters persist across reload** — search text, type, tags, tag mode, board, favorite, and sort now round-trip through `localStorage` the same way theme and layout already did.
- **Collapsible sidebar** — icon-only mode via edge toggle button, animated, state persisted.
- **Keyboard shortcuts** — global nav (`/`, `N`, `B`, `O`, `F`, `S`, `?`), `Esc` to close modals, `Ctrl`/`Cmd`+`Enter` to save, plus a Shortcuts tab listing them all.
- **Sort control in Browse** — sort dropdown in the filter bar (Newest, Oldest, A–Z, By Type).
- **Quick "open site" action on the grid card** — external-link icon in the card's hover overlay next to the favorite heart.
- **Loading state on initial page load** — spinner shown in the grid container while `loadAll()` is in flight.
- **Search matches the entry title** — `applyFilters` now checks `title` alongside `url`, `note`, and `style_tags`.
- **Unsaved-changes warning on the Add/Edit form** — a snapshot taken when the form loads is compared against on every nav attempt; a dirty form prompts "Discard unsaved changes?" before switching tabs, and `beforeunload` catches closing the tab/browser too.
