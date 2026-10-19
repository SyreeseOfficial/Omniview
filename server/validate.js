'use strict';

// Input checks shared by the route modules.
const httpError = (status, message) => Object.assign(new Error(message), { status });

function cleanString(v, field, max) {
  if (typeof v !== 'string') throw httpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length > max) throw httpError(400, `${field} is too long (max ${max})`);
  return s;
}

function cleanList(v, field, maxItem) {
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) throw httpError(400, `${field} must be an array of strings`);
  const list = [...new Set(v.map(s => s.trim()).filter(Boolean))];
  if (list.length > 200 || list.some(s => s.length > maxItem)) throw httpError(400, `${field} has too many or too long items`);
  return list;
}

// Only http(s) is accepted: the value ends up in <a href>, so `javascript:` must never be stored.
function cleanHttpUrl(v, field) {
  const s = cleanString(v, field, 2048);
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return s;
  } catch { /* fall through */ }
  throw httpError(400, `${field} must be an http(s) URL`);
}

// Case-insensitive lookup in a managed list; unknown names are registered, so
// filters and the Settings lists never disagree with what entries contain.
function canon(list, name) {
  const hit = list.find(o => o.toLowerCase() === name.toLowerCase());
  if (hit) return hit;
  list.push(name);
  return name;
}

const optional = v => (v == null || v === '' ? null : v);

module.exports = { httpError, cleanString, cleanList, cleanHttpUrl, canon, optional };
