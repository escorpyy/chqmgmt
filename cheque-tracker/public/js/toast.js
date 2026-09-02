// ============================================================================
// Toasts
// ============================================================================
export function toast(message, type = '') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
