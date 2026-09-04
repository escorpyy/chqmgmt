import { api } from './api.js';
import { toast } from './toast.js';
import { state } from './state.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { escapeHtml, humanize, selectOptions, enumOptions, debounce } from './utils.js';
import { PARTY_TYPES } from './constants.js';
import { loadReferenceData } from './referenceData.js';
import { registerMasterCreator, syncEditableSelect } from './combobox.js';

// ============================================================================
// PARTIES
// ============================================================================
export async function loadParties() {
  const search = document.getElementById('party-search').value;
  const type = document.getElementById('party-type-filter').value;
  const showDeleted = document.getElementById('party-show-deleted').checked;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (type) params.set('type', type);
  if (showDeleted) params.set('includeDeleted', 'true');
  try {
    const parties = await api(`/parties?${params.toString()}`);
    renderPartiesTable(parties);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderPartiesTable(parties) {
  const el = document.getElementById('parties-table');
  if (!parties.length) {
    el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No parties yet. Add a firm or individual to get started.</td></tr></tbody></table>`;
    return;
  }
  el.innerHTML = `
    <table class="ledger">
      <thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>Firm</th><th>PAN</th><th>Cheques</th><th></th></tr></thead>
      <tbody>
        ${parties.map((p) => `
          <tr class="${p.deletedAt ? 'row-deleted' : ''}" data-id="${p.id}">
            <td>${escapeHtml(p.name)}${p.deletedAt ? '<span class="tag-deleted">Deleted</span>' : ''}</td>
            <td>${humanize(p.type)}</td>
            <td class="num">${escapeHtml(p.phone || '—')}</td>
            <td>${escapeHtml(p.firm?.name || '—')}</td>
            <td class="num">${escapeHtml(p.panNo || '—')}</td>
            <td class="num">${(p._count?.cheques || 0) + (p._count?.paidCheques || 0)}</td>
            <td class="row-actions">
              <div class="row-actions-group">
                ${p.deletedAt
                  ? `<button class="btn btn-sm" data-action="restore">Restore</button>`
                  : `<button class="btn btn-sm" data-action="edit">Edit</button>
                     <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>`}
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('tr[data-id]').forEach((row) => {
    const party = parties.find((p) => p.id === row.dataset.id);
    row.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'edit') openEditPartyModal(party);
        if (action === 'delete') deleteParty(party);
        if (action === 'restore') restoreParty(party);
      });
    });
  });
}

document.getElementById('party-search').addEventListener('input', debounce(loadParties, 300));
document.getElementById('party-type-filter').addEventListener('change', loadParties);
document.getElementById('party-show-deleted').addEventListener('change', loadParties);

function openEditPartyModal(party) {
  const body = `
    <form id="form-edit-party">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Type</label>
          <input type="text" value="${humanize(party.type)}" disabled>
        </div>
        <div class="field">
          <label>Name *</label>
          <input name="name" type="text" required value="${escapeHtml(party.name)}">
        </div>
        <div class="field">
          <label>Phone</label>
          <input name="phone" type="text" value="${escapeHtml(party.phone || '')}">
        </div>
        <div class="field">
          <label>PAN no.</label>
          <input name="panNo" type="text" value="${escapeHtml(party.panNo || '')}">
        </div>
        <div class="field span-2">
          <label>Affiliated firm (if individual)</label>
          <select name="firmId" ${party.type === 'FIRM' ? 'disabled' : ''}>${selectOptions(state.parties.filter((p) => p.type === 'FIRM' && p.id !== party.id), 'id', (f) => f.name, 'None')}</select>
        </div>
        <div class="field span-2">
          <label>Address</label>
          <textarea name="address">${escapeHtml(party.address || '')}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-party">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit party — ${escapeHtml(party.name)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-party');
      form.querySelector('[name="firmId"]').value = party.firmId || '';
      syncEditableSelect(form.querySelector('[name="firmId"]'));
      document.getElementById('cancel-edit-party').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        if (party.type === 'FIRM') delete data.firmId;
        if (!data.firmId) delete data.firmId;
        try {
          await api(`/parties/${party.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Party updated', 'success');
          closeModal();
          await loadReferenceData();
          loadParties();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteParty(party) {
  const ok = await openConfirmModal(
    'Delete party?',
    `${escapeHtml(party.name)} will be hidden from new cheques, but existing history is kept and it can be restored later.`,
  );
  if (!ok) return;
  try {
    await api(`/parties/${party.id}`, { method: 'DELETE' });
    toast('Party deleted', 'success');
    await loadReferenceData();
    loadParties();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function restoreParty(party) {
  try {
    await api(`/parties/${party.id}/restore`, { method: 'POST' });
    toast('Party restored', 'success');
    await loadReferenceData();
    loadParties();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// `type` presets & locks the Type field — used when this is opened from the
// firmId editable dropdown, which only ever wants to create a firm.
export function openNewPartyModal({ name = '', type = '', onCreated } = {}) {
  const body = `
    <form id="form-new-party">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Type *</label>
          <select name="type" required ${type ? 'disabled' : ''}>${enumOptions(PARTY_TYPES)}</select>
        </div>
        <div class="field">
          <label>Name *</label>
          <input name="name" type="text" required value="${escapeHtml(name)}">
        </div>
        <div class="field">
          <label>Phone</label>
          <input name="phone" type="text">
        </div>
        <div class="field">
          <label>PAN no.</label>
          <input name="panNo" type="text">
        </div>
        <div class="field span-2">
          <label>Affiliated firm (if individual)</label>
          <select name="firmId">${selectOptions(state.parties.filter((p) => p.type === 'FIRM'), 'id', (f) => f.name, 'None')}</select>
        </div>
        <div class="field span-2">
          <label>Address</label>
          <textarea name="address"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-party">Cancel</button>
        <button type="submit" class="btn btn-primary">Save party</button>
      </div>
    </form>`;
  openModal('New party', body, {
    onMount: () => {
      const form = document.getElementById('form-new-party');
      if (type) form.querySelector('[name="type"]').value = type;
      document.getElementById('cancel-new-party').addEventListener('click', () => { closeModal(); onCreated?.(null); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        if (type) data.type = type; // disabled fields are excluded from FormData
        if (!data.firmId) delete data.firmId;
        try {
          const party = await api('/parties', { method: 'POST', body: JSON.stringify(data) });
          toast('Party saved', 'success');
          await loadReferenceData();
          loadParties();
          closeModal();
          onCreated?.(state.parties.find((p) => p.id === party.id) || party);
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

document.getElementById('btn-new-party').addEventListener('click', () => openNewPartyModal());

registerMasterCreator('payeeId', (typed, onCreated) => openNewPartyModal({ name: typed, onCreated }));
registerMasterCreator('issuerId', (typed, onCreated) => openNewPartyModal({ name: typed, onCreated }));
registerMasterCreator('firmId', (typed, onCreated) => openNewPartyModal({ name: typed, type: 'FIRM', onCreated }));
