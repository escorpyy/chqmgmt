import { api } from './api.js';
import { toast } from './toast.js';
import { state } from './state.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { escapeHtml, selectOptions } from './utils.js';
import { loadReferenceData } from './referenceData.js';
import { registerMasterCreator, syncEditableSelect } from './combobox.js';

// ============================================================================
// COMPANY BANK ACCOUNTS
// ============================================================================
export async function loadAccounts() {
  try {
    const accounts = await api('/company-bank-accounts');
    const el = document.getElementById('accounts-table');
    if (!accounts.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No accounts yet. Add the accounts cheques are issued from.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Account name</th><th>Bank</th><th>Account no.</th><th>Branch</th><th>Issued cheques</th><th></th></tr></thead>
        <tbody>
          ${accounts.map((a) => `
            <tr data-id="${a.id}">
              <td>${escapeHtml(a.accountName)}</td>
              <td>${escapeHtml(a.bank?.name || '—')}</td>
              <td class="num">${escapeHtml(a.accountNumber)}</td>
              <td>${escapeHtml(a.branch || '—')}</td>
              <td class="num">${(a._count?.issuedCheques || 0)}</td>
              <td class="row-actions">
                <div class="row-actions-group">
                  <button class="btn btn-sm" data-action="edit">Edit</button>
                  <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    el.querySelectorAll('tr[data-id]').forEach((row) => {
      const account = accounts.find((a) => a.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'edit') openEditAccountModal(account);
          if (action === 'delete') deleteAccount(account);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditAccountModal(account) {
  const body = `
    <form id="form-edit-account">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Bank *</label>
          <select name="bankId" required>${selectOptions(state.banks, 'id', (b) => b.name, 'Select bank…')}</select>
        </div>
        <div class="field span-2">
          <label>Account name *</label>
          <input name="accountName" type="text" required value="${escapeHtml(account.accountName)}">
        </div>
        <div class="field">
          <label>Account number *</label>
          <input name="accountNumber" type="text" required value="${escapeHtml(account.accountNumber)}">
        </div>
        <div class="field">
          <label>Branch</label>
          <input name="branch" type="text" value="${escapeHtml(account.branch || '')}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-account">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit account — ${escapeHtml(account.accountName)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-account');
      form.querySelector('[name="bankId"]').value = account.bankId || '';
      syncEditableSelect(form.querySelector('[name="bankId"]'));
      document.getElementById('cancel-edit-account').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/company-bank-accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Account updated', 'success');
          closeModal();
          await loadReferenceData();
          loadAccounts();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteAccount(account) {
  const ok = await openConfirmModal(
    'Delete account?',
    `${escapeHtml(account.accountName)} will be permanently removed. This only works if no issued cheques reference it.`,
  );
  if (!ok) return;
  try {
    await api(`/company-bank-accounts/${account.id}`, { method: 'DELETE' });
    toast('Account deleted', 'success');
    await loadReferenceData();
    loadAccounts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function openNewAccountModal({ name = '', onCreated } = {}) {
  const body = `
    <form id="form-new-account">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Bank *</label>
          <select name="bankId" required>${selectOptions(state.banks, 'id', (b) => b.name, 'Select bank…')}</select>
        </div>
        <div class="field span-2">
          <label>Account name *</label>
          <input name="accountName" type="text" required placeholder="e.g. B Enterprises Pvt. Ltd." value="${escapeHtml(name)}">
        </div>
        <div class="field">
          <label>Account number *</label>
          <input name="accountNumber" type="text" required>
        </div>
        <div class="field">
          <label>Branch</label>
          <input name="branch" type="text">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-account">Cancel</button>
        <button type="submit" class="btn btn-primary">Save account</button>
      </div>
    </form>`;
  openModal('New company bank account', body, {
    onMount: () => {
      const form = document.getElementById('form-new-account');
      document.getElementById('cancel-new-account').addEventListener('click', () => { closeModal(); onCreated?.(null); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          const account = await api('/company-bank-accounts', { method: 'POST', body: JSON.stringify(data) });
          toast('Account saved', 'success');
          await loadReferenceData();
          loadAccounts();
          closeModal();
          onCreated?.(state.accounts.find((a) => a.id === account.id) || account);
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

document.getElementById('btn-new-account').addEventListener('click', () => openNewAccountModal());

registerMasterCreator('companyBankAccountId', (typed, onCreated) => openNewAccountModal({ name: typed, onCreated }));
