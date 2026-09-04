import { api } from './api.js';
import { toast } from './toast.js';
import { state } from './state.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { escapeHtml } from './utils.js';
import { loadReferenceData } from './referenceData.js';
import { registerMasterCreator } from './combobox.js';

// ============================================================================
// FISCAL YEARS
// ============================================================================
export async function loadFiscalYears() {
  try {
    const fiscalYears = await api('/fiscal-years');
    const el = document.getElementById('fiscal-years-table');
    if (!fiscalYears.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No fiscal years yet.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Fiscal year</th><th>Cheques</th><th></th></tr></thead>
        <tbody>
          ${fiscalYears.map((f) => `
            <tr data-id="${f.id}">
              <td class="num">${escapeHtml(f.year)}</td>
              <td class="num">${(f._count?.cheques || 0)}</td>
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
      const fiscalYear = fiscalYears.find((f) => f.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'edit') openEditFiscalYearModal(fiscalYear);
          if (action === 'delete') deleteFiscalYear(fiscalYear);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditFiscalYearModal(fiscalYear) {
  const body = `
    <form id="form-edit-fiscal-year">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Fiscal year *</label>
          <input name="year" type="text" required value="${escapeHtml(fiscalYear.year)}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-fiscal-year">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit fiscal year — ${escapeHtml(fiscalYear.year)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-fiscal-year');
      document.getElementById('cancel-edit-fiscal-year').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/fiscal-years/${fiscalYear.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Fiscal year updated', 'success');
          closeModal();
          await loadReferenceData();
          loadFiscalYears();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteFiscalYear(fiscalYear) {
  const ok = await openConfirmModal(
    'Delete fiscal year?',
    `${escapeHtml(fiscalYear.year)} will be permanently removed. This only works if no cheques reference it.`,
  );
  if (!ok) return;
  try {
    await api(`/fiscal-years/${fiscalYear.id}`, { method: 'DELETE' });
    toast('Fiscal year deleted', 'success');
    await loadReferenceData();
    loadFiscalYears();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// `year` prefills the field with whatever was typed into an editable
// dropdown before "+ Create …" was picked; `onCreated(fiscalYear)` is
// called with the saved record right before the modal closes back to
// whatever opened it — `onCreated(null)` if the user cancels instead.
export function openNewFiscalYearModal({ year = '', onCreated } = {}) {
  const body = `
    <form id="form-new-fiscal-year">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Fiscal year *</label>
          <input name="year" type="text" required placeholder="2083/84" value="${escapeHtml(year)}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-fiscal-year">Cancel</button>
        <button type="submit" class="btn btn-primary">Save fiscal year</button>
      </div>
    </form>`;
  openModal('New fiscal year', body, {
    onMount: () => {
      const form = document.getElementById('form-new-fiscal-year');
      document.getElementById('cancel-new-fiscal-year').addEventListener('click', () => { closeModal(); onCreated?.(null); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          const fiscalYear = await api('/fiscal-years', { method: 'POST', body: JSON.stringify(data) });
          toast('Fiscal year saved', 'success');
          await loadReferenceData();
          loadFiscalYears();
          closeModal();
          onCreated?.(state.fiscalYears.find((f) => f.id === fiscalYear.id) || fiscalYear);
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

document.getElementById('btn-new-fiscal-year').addEventListener('click', () => openNewFiscalYearModal());

registerMasterCreator('fiscalYearId', (typed, onCreated) => openNewFiscalYearModal({ year: typed, onCreated }));
