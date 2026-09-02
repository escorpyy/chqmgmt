import { api } from './api.js';
import { state } from './state.js';

// ============================================================================
// Reference data
// ============================================================================
export async function loadReferenceData() {
  const [parties, banks, staff, accounts, receipts] = await Promise.all([
    api('/parties'), api('/banks'), api('/staff'), api('/company-bank-accounts'), api('/receipts'),
  ]);
  state.parties = parties;
  state.banks = banks;
  state.staff = staff;
  state.accounts = accounts;
  state.receipts = receipts;
}

export async function checkHealth() {
  const el = document.getElementById('db-status');
  try {
    const health = await api('/health');
    el.classList.toggle('ok', health.db === 'connected');
    el.classList.toggle('error', health.db !== 'connected');
    el.title = health.db === 'connected' ? 'Database connected' : 'Database disconnected';
  } catch {
    el.classList.add('error');
    el.title = 'Cannot reach the server';
  }
}
