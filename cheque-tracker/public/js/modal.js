// ============================================================================
// Modal
// ============================================================================
import { initBsDatePickers } from './bsDatePicker.js';
import { initAutocomplete } from './autocomplete.js';

export function openModal(titleHtml, bodyHtml, { onMount } = {}) {
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <div class="modal-header">
      <h2>${titleHtml}</h2>
      <button class="modal-close" id="modal-close-btn" aria-label="Close">×</button>
    </div>
    ${bodyHtml}
  `;
  document.getElementById('modal').classList.add('open');
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  initBsDatePickers(content);
  initAutocomplete(content); // must run after the BS pickers above so date suggestion chips have somewhere to attach
  if (onMount) onMount();
}

export function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.getElementById('modal-backdrop').classList.remove('open');
  document.getElementById('modal-content').innerHTML = '';
}

document.getElementById('modal-backdrop').addEventListener('click', closeModal);

export function formError(form, message) {
  const el = form.querySelector('.form-error');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
}

export function clearFormError(form) {
  const el = form.querySelector('.form-error');
  if (el) el.classList.remove('show');
}

// openConfirmModal: shows a confirmation dialog, resolves true/false with the user's choice.
export function openConfirmModal(title, message, { confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(result);
    };
    const body = `
      <p class="hint" style="margin-top:0">${message}</p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="confirm-cancel-btn">Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok-btn">${confirmLabel}</button>
      </div>`;
    openModal(title, body, {
      onMount: () => {
        document.getElementById('confirm-cancel-btn').addEventListener('click', () => finish(false));
        document.getElementById('confirm-ok-btn').addEventListener('click', () => finish(true));
      },
    });
    // Closing via the × button or backdrop also counts as "cancel".
    document.getElementById('modal-close-btn')?.addEventListener('click', () => finish(false));
    document.getElementById('modal-backdrop').addEventListener('click', () => finish(false), { once: true });
  });
}
