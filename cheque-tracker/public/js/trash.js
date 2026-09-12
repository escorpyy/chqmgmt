import { api } from './api.js';
import { toast } from './toast.js';
import { openModal, closeModal, formError } from './modal.js';
import { escapeHtml, fmtDate } from './utils.js';
import { loadReferenceData } from './referenceData.js';

// Cached after the first check — the role doesn't change mid-session, and
// this avoids an extra round trip on every render.
let isAdmin = null;
async function checkIsAdmin() {
  if (isAdmin !== null) return isAdmin;
  const me = await api('/auth/me');
  isAdmin = me.role === 'ADMIN';
  return isAdmin;
}

export async function loadTrash() {
  try {
    const [items, admin] = await Promise.all([api('/trash'), checkIsAdmin()]);
    const el = document.getElementById('trash-table');
    if (!items.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>Trash is empty.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Type</th><th>Item</th><th>Deleted</th><th></th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr data-kind="${item.kind}" data-id="${item.id}">
              <td>${escapeHtml(item.kindLabel)}</td>
              <td>${escapeHtml(item.label)}</td>
              <td>${fmtDate(item.deletedAt)}</td>
              <td class="row-actions">
                <button class="btn btn-sm" data-action="restore">Restore</button>
                ${admin ? `<button class="btn btn-sm btn-danger" data-action="delete-forever">Delete permanently</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    el.querySelectorAll('tr[data-kind]').forEach((row) => {
      const { kind, id } = row.dataset;
      const item = items.find((i) => i.kind === kind && i.id === id);
      row.querySelector('[data-action="restore"]').addEventListener('click', () => restoreItem(item));
      row.querySelector('[data-action="delete-forever"]')?.addEventListener('click', () => openPermanentDeleteModal(item));
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function restoreItem(item) {
  try {
    await api(`/trash/${item.kind}/${item.id}/restore`, { method: 'POST' });
    toast(`${item.kindLabel} restored`, 'success');
    await loadReferenceData(); // banks/staff/parties dropdowns elsewhere may now include it again
    loadTrash();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openPermanentDeleteModal(item) {
  const body = `
    <p class="hint" style="margin-top:0">
      This permanently deletes <strong>${escapeHtml(item.label)}</strong>. There is no undo — Trash is where recoverable
      deletes live, this is past that point. It will fail safely if anything (a cheque, an account, etc.) still
      references it.
    </p>
    <form id="form-permanent-delete" class="form-grid">
      <div class="field span-2">
        <label>Confirm your password</label>
        <input type="password" name="password" autocomplete="current-password" required autofocus>
      </div>
      <div class="form-error"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="permanent-delete-cancel">Cancel</button>
        <button type="submit" class="btn btn-danger">Delete permanently</button>
      </div>
    </form>`;

  openModal(`Permanently delete — ${escapeHtml(item.kindLabel)}`, body, {
    onMount: () => {
      document.getElementById('permanent-delete-cancel').addEventListener('click', closeModal);
      document.getElementById('form-permanent-delete').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = new FormData(e.currentTarget).get('password');
        try {
          await api(`/trash/${item.kind}/${item.id}`, { method: 'DELETE', body: JSON.stringify({ password }) });
          toast(`${item.kindLabel} permanently deleted`, 'success');
          closeModal();
          await loadReferenceData();
          loadTrash();
        } catch (err) {
          formError(e.currentTarget, err.message);
        }
      });
    },
  });
}
