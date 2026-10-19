'use strict';

// The shapes stored in db/*.json, for `npm run typecheck` (JSDoc only, no runtime code).
// normalizeEntry brings entries written by older versions up to Entry, so routes never guard a missing array.

/**
 * @typedef {object} Entry
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} note
 * @property {string | null} type
 * @property {string | null} color
 * @property {string[]} style_tags
 * @property {string} found_via
 * @property {string | null} favicon
 * @property {boolean} favorite
 * @property {boolean} bought
 * @property {string | null} visited_at
 * @property {string[]} boards board ids
 * @property {string} date_added ISO date
 * @property {string} [updated_at] ISO date, set by the first real edit
 * @property {string} [deleted_at] ISO date, only while in the trash
 * @property {string[]} screenshots file names in uploads/; the first is the cover
 * @property {string[]} remote_shots the screenshots that were fetched from the page rather than uploaded
 * @property {string[]} palette #rrggbb, dominant first
 * @property {Record<string, string>} image_hashes sha256 per screenshot file
 * @property {string} [brand] extra fields of a library (see SPACES in store.js)
 * @property {string} [price]
 * @property {string} [price_was]
 * @property {string | null} [screenshot] removed: read by normalizeEntry from files written before `screenshots`
 * @property {boolean} [pinned] removed feature, dropped on load
 */

/**
 * @typedef {object} Board
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} emoji
 * @property {string} color
 * @property {boolean} pinned
 * @property {string[]} order entry ids in manual order
 * @property {string} created ISO date
 */

/**
 * @typedef {object} Library
 * @property {Entry[]} entries
 * @property {Entry[]} trash
 * @property {Board[]} boards
 * @property {string[]} tags
 * @property {string[]} types
 * @property {string[]} foundVia
 */

module.exports = {};
