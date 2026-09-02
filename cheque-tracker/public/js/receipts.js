import { api } from './api.js';
import { toast } from './toast.js';
import { openModal, closeModal, formError, clearFormError } from './modal.js';
import { escapeHtml } from './utils.js';
import { loadReferenceData } from './referenceData.js';

// ============================================================================
// RECEIPTS
// ============================================================================
export async function loadReceipts() {
  try {
    const receipts = await api('/receipts');
    const el = document.getElementById('receipts-table');
    if (!receipts.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No receipts yet.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Fiscal year</th><th>Receipt no.</th><th>Cheques</th><th></th></tr></thead>
        <tbody>
          ${receipts.map((r) => `
            <tr data-id="${r.id}">
              <td class="num">${escapeHtml(r.fiscalYear)}</td>
              <td class="num">${escapeHtml(r.receiptNo || '—')}</td>
              <td class="num">${(r._count?.cheques || 0)}</td>
              <td class="row-actions">
                <div class="row-actions-group">
                  <button class="btn btn-sm" data-action="edit">Edit</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    el.querySelectorAll('tr[data-id]').forEach((row) => {
      const receipt = receipts.find((r) => r.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.dataset.action === 'edit') openEditReceiptModal(receipt);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditReceiptModal(receipt) {
  const body = `
    <form id="form-edit-receipt">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Fiscal year *</label>
          <input name="fiscalYear" type="text" required value="${escapeHtml(receipt.fiscalYear)}">
        </div>
        <div class="field">
          <label>Receipt no.</label>
          <input name="receiptNo" type="text" value="${escapeHtml(receipt.receiptNo || '')}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-receipt">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit receipt — ${escapeHtml(receipt.fiscalYear)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-receipt');
      document.getElementById('cancel-edit-receipt').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/receipts/${receipt.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Receipt updated', 'success');
          closeModal();
          await loadReferenceData();
          loadReceipts();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

document.getElementById('btn-new-receipt').addEventListener('click', () => {
  const body = `
    <form id="form-new-receipt">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Fiscal year *</label>
          <input name="fiscalYear" type="text" required placeholder="2083/84">
        </div>
        <div class="field">
          <label>Receipt no.</label>
          <input name="receiptNo" type="text" placeholder="UR-001">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-receipt">Cancel</button>
        <button type="submit" class="btn btn-primary">Save receipt</button>
      </div>
    </form>`;
  openModal('New receipt', body, {
    onMount: () => {
      const form = document.getElementById('form-new-receipt');
      document.getElementById('cancel-new-receipt').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/receipts', { method: 'POST', body: JSON.stringify(data) });
          toast('Receipt saved', 'success');
          closeModal();
          await loadReferenceData();
          loadReceipts();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
});
