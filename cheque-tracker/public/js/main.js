// Importing tabs.js pulls in (and registers the event listeners for) every
// feature module: dashboard, received, issued, dailyBalance, parties, banks,
// accounts, staff and receipts.
import './tabs.js';

import { checkHealth, loadReferenceData } from './referenceData.js';
import { loadDashboard } from './dashboard.js';
import { toast } from './toast.js';
import { closeModal } from './modal.js';
import { closeDrawer } from './drawer.js';

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
  await checkHealth();
  try {
    await loadReferenceData();
  } catch (err) {
    toast(`Could not load reference data: ${err.message}`, 'error');
  }
  loadDashboard();
})();
