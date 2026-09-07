import { API } from './constants.js';

// If already signed in, skip the login page entirely.
(async function redirectIfLoggedIn() {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
    if (res.ok) window.location.href = 'index.html';
  } catch { /* server unreachable — let them try logging in */ }
})();

const form = document.getElementById('login-form');
const errorEl = form.querySelector('.form-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  errorEl.classList.remove('show');

  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorEl.textContent = body.error || 'Sign in failed';
      errorEl.classList.add('show');
      return;
    }
    window.location.href = 'index.html';
  } catch {
    errorEl.textContent = 'Could not reach the server';
    errorEl.classList.add('show');
  }
});
