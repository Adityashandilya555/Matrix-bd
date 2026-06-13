// API client — fetch wrapper with base URL and auth header.
import { getAuthToken } from './authToken.js';

// TODO(db): set BASE_URL from env once backend is deployed.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

function authHeader() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`API ${options.method || 'GET'} ${path} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

export const api = {
  get:    (path)         => apiFetch(path, { method: 'GET' }),
  post:   (path, body)   => apiFetch(path, { method: 'POST', body }),
  patch:  (path, body)   => apiFetch(path, { method: 'PATCH', body }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),
};
