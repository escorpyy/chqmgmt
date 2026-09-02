import { API } from './constants.js';

// ============================================================================
// API client
// ============================================================================
export async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const message = (body && body.error) ? body.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}
