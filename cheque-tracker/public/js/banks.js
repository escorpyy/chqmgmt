import { api } from './api.js';
import { toast } from './toast.js';
import { state } from './state.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { escapeHtml } from './utils.js';
import { loadReferenceData } from './referenceData.js';
import { registerMasterCreator } from './combobox.js';

// ============================================================================
// BANKS
// ============================================================================
export async function loadBanks() {
  try {
    const banks = await api('/banks');
    const el = document.getElementById('banks-table');
    if (!banks.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No banks yet.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Bank</th><th>Branch</th><th>Received cheques</th><th>Our accounts</th><th></th></tr></thead>
        <tbody>
          ${banks.map((b) => `
            <tr data-id="${b.id}">
              <td>${escapeHtml(b.name)}</td>
              <td>${escapeHtml(b.branch || '—')}</td>
              <td class="num">${(b._count?.draweeCheques || 0)}</td>
              <td class="num">${(b._count?.companyAccounts || 0)}</td>
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
      const bank = banks.find((b) => b.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'edit') openEditBankModal(bank);
          if (action === 'delete') deleteBank(bank);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditBankModal(bank) {
  const body = `
    <form id="form-edit-bank">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Bank name *</label>
          <input name="name" type="text" required value="${escapeHtml(bank.name)}">
        </div>
        <div class="field span-2">
          <label>Branch</label>
          <input name="branch" type="text" value="${escapeHtml(bank.branch || '')}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-bank">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit bank — ${escapeHtml(bank.name)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-bank');
      document.getElementById('cancel-edit-bank').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/banks/${bank.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Bank updated', 'success');
          closeModal();
          await loadReferenceData();
          loadBanks();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteBank(bank) {
  const ok = await openConfirmModal(
    'Delete bank?',
    `${escapeHtml(bank.name)} will be permanently removed. This only works if no cheques or accounts reference it.`,
  );
  if (!ok) return;
  try {
    await api(`/banks/${bank.id}`, { method: 'DELETE' });
    toast('Bank deleted', 'success');
    await loadReferenceData();
    loadBanks();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// `name` prefills the bank-name field (e.g. with whatever was typed into an
// editable dropdown before "+ Create …" was picked); `onCreated(bank)` is
// called with the saved bank right before the modal closes back to whatever
// opened it — `onCreated(null)` if the user cancels instead.
export function openNewBankModal({ name = '', onCreated } = {}) {
  const body = `
    <form id="form-new-bank">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Bank name *</label>
          <input name="name" type="text" required value="${escapeHtml(name)}">
        </div>
        <div class="field span-2">
          <label>Branch</label>
          <input name="branch" type="text">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-bank">Cancel</button>
        <button type="submit" class="btn btn-primary">Save bank</button>
      </div>
    </form>`;
  openModal('New bank', body, {
    onMount: () => {
      const form = document.getElementById('form-new-bank');
      document.getElementById('cancel-new-bank').addEventListener('click', () => { closeModal(); onCreated?.(null); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          const bank = await api('/banks', { method: 'POST', body: JSON.stringify(data) });
          toast('Bank saved', 'success');
          await loadReferenceData();
          loadBanks();
          closeModal();
          onCreated?.(state.banks.find((b) => b.id === bank.id) || bank);
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

document.getElementById('btn-new-bank').addEventListener('click', () => openNewBankModal());

registerMasterCreator('bankId', (typed, onCreated) => openNewBankModal({ name: typed, onCreated }));
registerMasterCreator('presentedBankId', (typed, onCreated) => openNewBankModal({ name: typed, onCreated }));
