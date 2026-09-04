// Importing tabs.js pulls in (and registers the event listeners for) every
// feature module: dashboard, received, issued, dailyBalance, parties, banks,
// accounts, staff and receipts.
import './tabs.js';

import { checkHealth, loadReferenceData } from './referenceData.js';
import { loadDashboard } from './dashboard.js';
import { toast } from './toast.js';
import { closeModal } from './modal.js';
import { closeDrawer } from './drawer.js';
import { initBsDatePickers } from './bsDatePicker.js';
import { initEditableSelects } from './combobox.js';
import { initAutocomplete } from './autocomplete.js';

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
  initBsDatePickers(document); // e.g. the daily-balance date picker, present at load
  initEditableSelects(document);
  initAutocomplete(document); // e.g. the toolbar search/filter fields, present at load
  await checkHealth();
  try {
    await loadReferenceData();
  } catch (err) {
    toast(`Could not load reference data: ${err.message}`, 'error');
  }
  loadDashboard();
})();
