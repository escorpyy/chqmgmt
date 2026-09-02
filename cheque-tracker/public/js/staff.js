import { api } from './api.js';
import { toast } from './toast.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { escapeHtml } from './utils.js';
import { loadReferenceData } from './referenceData.js';

// ============================================================================
// STAFF
// ============================================================================
export async function loadStaff() {
  try {
    const staff = await api('/staff');
    const el = document.getElementById('staff-table');
    if (!staff.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No staff yet.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Name</th><th>Phone</th><th></th></tr></thead>
        <tbody>
          ${staff.map((s) => `
            <tr data-id="${s.id}">
              <td>${escapeHtml(s.name)}</td>
              <td class="num">${escapeHtml(s.phone || '—')}</td>
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
      const member = staff.find((s) => s.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'edit') openEditStaffModal(member);
          if (action === 'delete') deleteStaff(member);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditStaffModal(member) {
  const body = `
    <form id="form-edit-staff">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Name *</label>
          <input name="name" type="text" required value="${escapeHtml(member.name)}">
        </div>
        <div class="field span-2">
          <label>Phone</label>
          <input name="phone" type="text" value="${escapeHtml(member.phone || '')}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-staff">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit staff — ${escapeHtml(member.name)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-staff');
      document.getElementById('cancel-edit-staff').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/staff/${member.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Staff updated', 'success');
          closeModal();
          await loadReferenceData();
          loadStaff();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteStaff(member) {
  const ok = await openConfirmModal(
    'Delete staff member?',
    `${escapeHtml(member.name)} will be permanently removed. This only works if no cheques reference them.`,
  );
  if (!ok) return;
  try {
    await api(`/staff/${member.id}`, { method: 'DELETE' });
    toast('Staff deleted', 'success');
    await loadReferenceData();
    loadStaff();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-new-staff').addEventListener('click', () => {
  const body = `
    <form id="form-new-staff">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Name *</label>
          <input name="name" type="text" required>
        </div>
        <div class="field span-2">
          <label>Phone</label>
          <input name="phone" type="text">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-staff">Cancel</button>
        <button type="submit" class="btn btn-primary">Save staff</button>
      </div>
    </form>`;
  openModal('New staff', body, {
    onMount: () => {
      const form = document.getElementById('form-new-staff');
      document.getElementById('cancel-new-staff').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/staff', { method: 'POST', body: JSON.stringify(data) });
          toast('Staff saved', 'success');
          closeModal();
          await loadReferenceData();
          loadStaff();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
});
