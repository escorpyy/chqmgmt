import { api } from './api.js';
import { toast } from './toast.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { escapeHtml } from './utils.js';

// ============================================================================
// USERS (admin only — route itself is guarded server-side; this tab is only
// ever added to the DOM for an ADMIN session, see main.js)
// ============================================================================
export async function loadUsers() {
  try {
    const users = await api('/users');
    const el = document.getElementById('users-table');
    if (!users.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No users yet.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr data-id="${u.id}">
              <td>${escapeHtml(u.username)}</td>
              <td>${u.role === 'ADMIN' ? 'Admin' : 'Staff'}</td>
              <td>${u.isActive ? 'Active' : 'Deactivated'}</td>
              <td class="num">${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
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
      const user = users.find((u) => u.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'edit') openEditUserModal(user);
          if (action === 'delete') deleteUser(user);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditUserModal(user) {
  const body = `
    <form id="form-edit-user">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Username</label>
          <input type="text" value="${escapeHtml(user.username)}" disabled>
        </div>
        <div class="field">
          <label>Role</label>
          <select name="role">
            <option value="STAFF" ${user.role === 'STAFF' ? 'selected' : ''}>Staff</option>
            <option value="ADMIN" ${user.role === 'ADMIN' ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <div class="field">
          <label>Status</label>
          <select name="isActive">
            <option value="true" ${user.isActive ? 'selected' : ''}>Active</option>
            <option value="false" ${!user.isActive ? 'selected' : ''}>Deactivated</option>
          </select>
        </div>
        <div class="field span-2">
          <label>Reset password</label>
          <input name="password" type="password" placeholder="Leave blank to keep current password" autocomplete="new-password">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-user">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit user — ${escapeHtml(user.username)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-user');
      document.getElementById('cancel-edit-user').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        const patch = { role: data.role, isActive: data.isActive === 'true' };
        if (data.password) patch.password = data.password;
        try {
          await api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
          toast('User updated', 'success');
          closeModal();
          loadUsers();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteUser(user) {
  const ok = await openConfirmModal(
    'Delete user?',
    `${escapeHtml(user.username)} will lose access immediately. This cannot be undone.`,
  );
  if (!ok) return;
  try {
    await api(`/users/${user.id}`, { method: 'DELETE' });
    toast('User deleted', 'success');
    loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openNewUserModal() {
  const body = `
    <form id="form-new-user">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Username *</label>
          <input name="username" type="text" required autocomplete="off">
        </div>
        <div class="field">
          <label>Role</label>
          <select name="role">
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <div class="field">
          <label>Password *</label>
          <input name="password" type="password" required minlength="8" autocomplete="new-password">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-user">Cancel</button>
        <button type="submit" class="btn btn-primary">Create user</button>
      </div>
    </form>`;
  openModal('New user', body, {
    onMount: () => {
      const form = document.getElementById('form-new-user');
      document.getElementById('cancel-new-user').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/users', { method: 'POST', body: JSON.stringify(data) });
          toast('User created', 'success');
          closeModal();
          loadUsers();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

// Wiring is deferred to this explicit call (invoked only for admin sessions,
// see main.js) rather than run at module-import time, since the "+ New
// user" button only ever matters for admins.
export function initUsersTab() {
  document.getElementById('btn-new-user').addEventListener('click', openNewUserModal);
}
