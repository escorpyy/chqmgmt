// ============================================================================
// Modal
// ============================================================================
import { initBsDatePickers } from './bsDatePicker.js';
import { initEditableSelects } from './combobox.js';
import { initAutocomplete } from './autocomplete.js';

// When a modal is opened while another is already open (e.g. an editable
// dropdown's "+ Create …" opens a master table's own creation form on top of
// the form it was triggered from), the modal that's already showing is
// stashed here — as its live DOM nodes, not a re-render — rather than
// discarded. closeModal() then pops one level back instead of closing
// outright, and the stashed form reappears exactly as the user left it
// (every field's value, including any in-progress combobox state, is
// untouched, since it's the same nodes with the same listeners, not a
// rebuild). An ordinary single modal never pushes anything here, so
// closeModal() behaves exactly as before in every other case.
const modalStack = [];

export function openModal(titleHtml, bodyHtml, { onMount } = {}) {
  const content = document.getElementById('modal-content');
  const alreadyOpen = document.getElementById('modal').classList.contains('open');
  if (alreadyOpen && content.childNodes.length) {
    modalStack.push(Array.from(content.childNodes));
  }
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
  initEditableSelects(content); // converts master-table-backed <select>s into editable dropdowns
  initAutocomplete(content); // must run after the BS pickers above so date suggestion chips have somewhere to attach
  if (onMount) onMount();
}

export function closeModal() {
  const content = document.getElementById('modal-content');
  if (modalStack.length) {
    content.replaceChildren(...modalStack.pop());
    return; // back one level — the modal itself stays open
  }
  document.getElementById('modal').classList.remove('open');
  document.getElementById('modal-backdrop').classList.remove('open');
  content.innerHTML = '';
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
