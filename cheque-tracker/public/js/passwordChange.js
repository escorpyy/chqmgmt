import { API } from './constants.js';
import { openModal, closeModal, formError, clearFormError } from './modal.js';

// Blocks app boot until a new password is set — used for the
// auto-provisioned admin account's random initial password (and reusable
// for any future admin-triggered reset). Not dismissable: no × button, no
// backdrop click, no Escape — see modal.js's dismissable handling.
export function forcePasswordChange() {
  return new Promise((resolve) => {
    const body = `
      <p class="hint" style="margin-top:0">
        This account needs a new password before continuing — either this is the first login on a
        fresh install, or an admin reset it.
      </p>
      <form id="form-change-password">
        <div class="form-error"></div>
        <div class="form-grid">
          <div class="field span-2">
            <label>Current password *</label>
            <input name="currentPassword" type="password" required autocomplete="current-password" autofocus>
          </div>
          <div class="field span-2">
            <label>New password * (min. 8 characters)</label>
            <input name="newPassword" type="password" required autocomplete="new-password" minlength="8">
          </div>
          <div class="field span-2">
            <label>Confirm new password *</label>
            <input name="confirmPassword" type="password" required autocomplete="new-password" minlength="8">
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Set new password</button>
        </div>
      </form>`;

    openModal('Set a new password', body, {
      dismissable: false,
      onMount: () => {
        const form = document.getElementById('form-change-password');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          clearFormError(form);
          const data = Object.fromEntries(new FormData(form).entries());
          if (data.newPassword !== data.confirmPassword) {
            formError(form, 'New password and confirmation do not match');
            return;
          }
          try {
            const res = await fetch(`${API}/auth/change-password`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              formError(form, errBody.error || 'Could not update password');
              return;
            }
            closeModal();
            resolve();
          } catch {
            formError(form, 'Could not reach the server');
          }
        });
      },
    });
  });
}
