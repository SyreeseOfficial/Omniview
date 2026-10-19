// Thin fetch wrapper. Every request carries X-Omniview: the server refuses
// mutating requests without it, which stops other websites from calling the API.
// X-Space says which library the call is about; a delayed call (the delete-undo
// timer) passes the space it was made in, in case the user has switched since.

import { state } from './state.js';

async function request(method, path, body, space = state.space) {
  const opts = { method, headers: { 'X-Omniview': '1', 'X-Space': space } };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${r.status})`), { status: r.status, data });
  return data;
}

export const api = {
  get: (path, space) => request('GET', path, undefined, space),
  post: (path, body = {}, space) => request('POST', path, body, space),
  put: (path, body, space) => request('PUT', path, body, space),
  del: path => request('DELETE', path),
  uploadScreenshot(entryId, file) {
    const fd = new FormData();
    fd.append('screenshot', file);
    return request('POST', `/api/entries/${entryId}/screenshot`, fd);
  }
};
