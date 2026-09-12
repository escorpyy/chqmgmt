import { API } from './constants.js';

// ============================================================================
// API client
// ============================================================================
export async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // send the session cookie
    ...options,
  });
  // Session expired or was never established — bounce to the login page
  // rather than surfacing a confusing "Not authenticated" toast. The login
  // page itself calls /api/auth/me, not this helper, so this never loops.
  if (res.status === 401) {
    window.location.href = 'login.html';
    return new Promise(() => {}); // never resolves; navigation is already underway
  }
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