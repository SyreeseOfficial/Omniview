// Thin fetch wrapper. Every request carries X-Omniview: the server refuses
// mutating requests without it, which stops other websites from calling the API.

async function request(method, path, body) {
  const opts = { method, headers: { 'X-Omniview': '1' } };
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
  get: path => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: path => request('DELETE', path),
  uploadScreenshot(entryId, file) {
    const fd = new FormData();
    fd.append('screenshot', file);
    return request('POST', `/api/entries/${entryId}/screenshot`, fd);
  }
};
