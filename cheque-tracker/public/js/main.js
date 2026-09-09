// Importing tabs.js pulls in (and registers the event listeners for) every
// feature module: dashboard, received, issued, dailyBalance, parties, banks,
// accounts, staff and fiscal years.
import './tabs.js';

import { API } from './constants.js';
import { checkHealth, loadReferenceData } from './referenceData.js';
import { loadDashboard } from './dashboard.js';
import { toast } from './toast.js';
import { closeModal } from './modal.js';
import { closeDrawer } from './drawer.js';
import { initBsDatePickers } from './bsDatePicker.js';
import { initEditableSelects } from './combobox.js';
import { initAutocomplete } from './autocomplete.js';
import { initUsersTab } from './users.js';
import { initCompanySwitcher } from './companySwitcher.js';

// ============================================================================
// Auth gate — every other module below assumes a valid session, so this
// runs before anything touches the API.
// ============================================================================
async function requireSession() {
  const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
  if (!res.ok) {
    window.location.href = 'login.html';
    return null;
  }
  return res.json();
}

function renderUserBadge(user) {
  const host = document.getElementById('masthead-stats');
  const badge = document.createElement('div');
  badge.className = 'stat';
  badge.innerHTML = `
    <span class="stat-label">Signed in as</span>
    <span class="stat-value" style="font-size:0.85rem">
      ${user.username}${user.role === 'ADMIN' ? ' (admin)' : ''}
      &nbsp;<button class="btn btn-sm" id="btn-logout" type="button">Sign out</button>
    </span>`;
  host.appendChild(badge);
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = 'login.html';
  });

  if (user.role === 'ADMIN') {
    document.getElementById('tabs').insertAdjacentHTML(
      'beforeend',
      '<button class="tab" data-tab="users">Users</button>',
    );
    initUsersTab();
  }
}

// ============================================================================
// Global keyboard shortcuts
// ============================================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeDrawer();
  }
});

// ============================================================================
// Boot
// ============================================================================
(async function init() {
  const user = await requireSession();
  if (!user) return; // already redirecting to login.html
  renderUserBadge(user);

  initBsDatePickers(document); // e.g. the daily-balance date picker, present at load
  initEditableSelects(document);
  initAutocomplete(document); // e.g. the toolbar search/filter fields, present at load
  await checkHealth();

  // Blocks (via a required modal, for a brand-new user) until a company is
  // selected in session — every company-scoped API route below this point
  // depends on that being in place already.
  await initCompanySwitcher();

  try {
    await loadReferenceData();
  } catch (err) {
    toast(`Could not load reference data: ${err.message}`, 'error');
  }
  loadDashboard();
})();
