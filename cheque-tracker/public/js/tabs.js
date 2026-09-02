import { loadDashboard } from './dashboard.js';
import { loadReceived } from './received.js';
import { loadIssued } from './issued.js';
import { loadDailyBalance } from './dailyBalance.js';
import { loadParties } from './parties.js';
import { loadBanks } from './banks.js';
import { loadAccounts } from './accounts.js';
import { loadStaff } from './staff.js';
import { loadReceipts } from './receipts.js';

// ============================================================================
// Tabs
// ============================================================================
const TAB_LOADERS = {
  dashboard: loadDashboard,
  received: loadReceived,
  issued: loadIssued,
  'daily-balance': loadDailyBalance,
  parties: loadParties,
  banks: loadBanks,
  accounts: loadAccounts,
  staff: loadStaff,
  receipts: loadReceipts,
};

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  activateTab(btn.dataset.tab);
});

export function activateTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
  TAB_LOADERS[tab]?.();
}
