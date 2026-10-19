// Thin fetch wrapper. Every request carries X-Omniview: the server refuses
// mutating requests without it, which stops other websites from calling the API.
// X-Space says which library the call is about; a delayed call (the delete-undo
// timer) passes the space it was made in, in case the user has switched since.

import { state, SPACES } from './state.js';
import { showToast } from './modals.js';

async function request(method, path, body, space = state.space) {
  const opts = { method, headers: { 'X-Omniview': '1', 'X-Space': space } };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  // The server flags a failed disk write on every answer; keep the warning up until it clears.
  const saveError = r.headers.get('x-save-error');
  const banner = document.getElementById('save-banner');
  banner.hidden = !saveError;
  if (saveError) banner.textContent = `Changes are not being saved (${saveError}). Is the disk full or read-only? Omniview keeps retrying.`;
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${r.status})`), { status: r.status, data });
  return data;
}

// An upload that matches a screenshot already saved is still kept; the user is just told.
function noteDuplicateImage(res) {
  const d = res.duplicateOf;
  if (d) showToast(`This image is already on "${d.title}"${d.space !== state.space ? ` (${SPACES[d.space]} library)` : ''}${d.trashed ? ' (in the trash)' : ''}.`);
  return res;
}

export const api = {
  get: (path, space) => request('GET', path, undefined, space),
  post: (path, body = {}, space) => request('POST', path, body, space),
  put: (path, body, space) => request('PUT', path, body, space),
  del: path => request('DELETE', path),
  uploadScreenshot(entryId, file) {
    const fd = new FormData();
    fd.append('screenshot', file);
    return request('POST', `/api/entries/${entryId}/screenshot`, fd).then(noteDuplicateImage);
  },
  postScreenshotUrl: (entryId, url) => request('POST', `/api/entries/${entryId}/screenshot-url`, { url }).then(noteDuplicateImage)
};
