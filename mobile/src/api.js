import { API_BASE } from './config';

// One place for every request to the MyTrack backend. It attaches the saved
// session token as `Authorization: Bearer <token>` — the server's
// getCurrentUser() accepts that exactly like the website's cookie.
let authToken = null;
export function setApiToken(token) {
  authToken = token || null;
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  const t = token || authToken;
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Network error — check your connection and the server URL.');
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path, token) => request(path, { token }),
  post: (path, body, token) => request(path, { method: 'POST', body, token }),
  patch: (path, body, token) => request(path, { method: 'PATCH', body, token }),
  put: (path, body, token) => request(path, { method: 'PUT', body, token }),
  del: (path, token) => request(path, { method: 'DELETE', token }),
};

// ---- auth ----
export async function login(email, password) {
  // Server returns { ok, token, eventId }
  const data = await api.post('/api/auth/login', { email, password });
  return data;
}
export async function register(name, email, password) {
  return api.post('/api/auth/register', { name, email, password });
}
export async function fetchMe(token) {
  return api.get('/api/auth/me', token);
}
