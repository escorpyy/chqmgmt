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
  const role = document.getElementById('party-role-filter').value;
  const showDeleted = document.getElementById('party-show-deleted').checked;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (type) params.set('type', type);
  if (role) params.set('role', role);
  if (showDeleted) params.set('includeDeleted', 'true');
  try {
    const parties = await api(`/parties?${params.toString()}`);
    renderPartiesTable(parties);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function partyRoleLabel(party) {
  if (party.isCustomer && party.isVendor) return 'Customer &amp; vendor';
  if (party.isVendor) return 'Vendor';
  return 'Customer'; // isCustomer is the only remaining true case — every party is at least one
}

function renderPartiesTable(parties) {
  const el = document.getElementById('parties-table');
  if (!parties.length) {
    el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No parties yet. Add a firm or individual to get started.</td></tr></tbody></table>`;
    return;
  }
  el.innerHTML = `
    <table class="ledger">
      <thead><tr><th>Name</th><th>Type</th><th>Role</th><th>Phone</th><th>Firm</th><th>PAN</th><th>Cheques</th><th></th></tr></thead>
      <tbody>
        ${parties.map((p) => `
          <tr class="${p.deletedAt ? 'row-deleted' : ''}" data-id="${p.id}">
            <td>${escapeHtml(p.name)}${p.deletedAt ? '<span class="tag-deleted">Deleted</span>' : ''}</td>
            <td>${humanize(p.type)}</td>
            <td>${partyRoleLabel(p)}</td>
            <td class="num">${escapeHtml(p.phone || '—')}</td>
            <td>${escapeHtml(p.firm?.name || '—')}</td>
            <td class="num">${escapeHtml(p.panNo || p.firm?.panNo || '—')}</td>
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
document.getElementById('party-role-filter').addEventListener('change', loadParties);
document.getElementById('party-show-deleted').addEventListener('change', loadParties);

function openEditPartyModal(party) {
  const isIndividual = party.type === 'INDIVIDUAL';
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
        <div class="field span-2">
          <label>Role *</label>
          <div class="checkbox-group">
            <label class="checkbox-field"><input type="checkbox" name="isCustomer" ${party.isCustomer ? 'checked' : ''}> Customer</label>
            <label class="checkbox-field"><input type="checkbox" name="isVendor" ${party.isVendor ? 'checked' : ''}> Vendor</label>
          </div>
          <span class="hint" id="edit-party-role-hint"></span>
        </div>
        ${isIndividual
          ? `<div class="field">
               <label>PAN no.</label>
               <input type="text" id="edit-party-pan-display" value="${escapeHtml(party.firm?.panNo || 'No affiliated firm')}" disabled>
               <span class="hint">An individual's PAN comes from their affiliated firm, not entered directly here.</span>
             </div>`
          : `<div class="field">
               <label>PAN no.</label>
               <input name="panNo" type="text" value="${escapeHtml(party.panNo || '')}">
             </div>`}
        <div class="field span-2">
          <label>Affiliated firm (if individual)</label>
          <select name="firmId" id="edit-party-firm" ${party.type === 'FIRM' ? 'disabled' : ''}>${selectOptions(state.parties.filter((p) => p.type === 'FIRM' && p.id !== party.id), 'id', (f) => f.name, 'None')}</select>
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
      if (isIndividual) {
        const panDisplay = document.getElementById('edit-party-pan-display');
        document.getElementById('edit-party-firm').addEventListener('change', (e) => {
          const firm = state.parties.find((p) => p.id === e.target.value);
          panDisplay.value = firm?.panNo || 'No affiliated firm';
        });
      }
      document.getElementById('cancel-edit-party').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        if (party.type === 'FIRM') delete data.firmId;
        if (!data.firmId) delete data.firmId;
        data.isCustomer = form.querySelector('[name="isCustomer"]').checked;
        data.isVendor = form.querySelector('[name="isVendor"]').checked;
        if (!data.isCustomer && !data.isVendor) {
          formError(form, 'Pick at least one role: customer, vendor, or both.');
          return;
        }
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
// `presetRole` ('customer' | 'vendor') pre-checks the matching role box —
// used when this is opened from the issuer or payee combobox's "add new"
// action, so a vendor typed into the payee field doesn't default to
// Customer-only and vanish from that same dropdown once saved.
export function openNewPartyModal({ name = '', type = '', presetRole = '', onCreated } = {}) {
  const defaultCustomer = presetRole !== 'vendor';
  const defaultVendor = presetRole === 'vendor';
  const body = `
    <form id="form-new-party">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Type *</label>
          <select name="type" id="new-party-type" required ${type ? 'disabled' : ''}>${enumOptions(PARTY_TYPES)}</select>
        </div>
        <div class="field">
          <label>Name *</label>
          <input name="name" type="text" required value="${escapeHtml(name)}">
        </div>
        <div class="field">
          <label>Phone</label>
          <input name="phone" type="text">
        </div>
        <div class="field span-2">
          <label>Role *</label>
          <div class="checkbox-group">
            <label class="checkbox-field"><input type="checkbox" name="isCustomer" id="new-party-is-customer" ${defaultCustomer ? 'checked' : ''}> Customer</label>
            <label class="checkbox-field"><input type="checkbox" name="isVendor" id="new-party-is-vendor" ${defaultVendor ? 'checked' : ''}> Vendor</label>
          </div>
        </div>
        <div class="field" id="new-party-pan-field">
          <label>PAN no.</label>
          <input name="panNo" type="text">
        </div>
        <div class="field span-2">
          <label>Affiliated firm (if individual)</label>
          <select name="firmId" id="new-party-firm">${selectOptions(state.parties.filter((p) => p.type === 'FIRM'), 'id', (f) => f.name, 'None')}</select>
          <!-- Only shown for an individual — a firm's PAN doesn't come
               from anywhere else, so there's nothing to inherit for it. -->
          <span class="hint" id="new-party-firm-pan"></span>
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

      // An individual doesn't get their own PAN field — most individuals
      // have none, and when they do act for a firm, that firm's own PAN is
      // the one that matters. Show it read-only instead, once a firm is
      // picked, rather than asking for a redundant PAN entry here.
      const typeSelect = document.getElementById('new-party-type');
      const panField = document.getElementById('new-party-pan-field');
      const firmSelect = document.getElementById('new-party-firm');
      const firmPanHint = document.getElementById('new-party-firm-pan');
      const updateFirmPanHint = () => {
        const firm = state.parties.find((p) => p.id === firmSelect.value);
        firmPanHint.textContent = firm?.panNo ? `Firm PAN: ${firm.panNo}` : '';
      };
      const applyTypeToggle = () => {
        const isIndividual = typeSelect.value === 'INDIVIDUAL';
        panField.style.display = isIndividual ? 'none' : '';
        updateFirmPanHint();
      };
      typeSelect.addEventListener('change', applyTypeToggle);
      firmSelect.addEventListener('change', updateFirmPanHint);
      applyTypeToggle();

      document.getElementById('cancel-new-party').addEventListener('click', () => { closeModal(); onCreated?.(null); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        if (type) data.type = type; // disabled fields are excluded from FormData
        if (!data.firmId) delete data.firmId;
        if (data.type === 'INDIVIDUAL') delete data.panNo; // comes from the firm, not entered here
        data.isCustomer = form.querySelector('[name="isCustomer"]').checked;
        data.isVendor = form.querySelector('[name="isVendor"]').checked;
        if (!data.isCustomer && !data.isVendor) {
          formError(form, 'Pick at least one role: customer, vendor, or both.');
          return;
        }
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

registerMasterCreator('payeeId', (typed, onCreated) => openNewPartyModal({ name: typed, presetRole: 'vendor', onCreated }));
registerMasterCreator('issuerId', (typed, onCreated) => openNewPartyModal({ name: typed, presetRole: 'customer', onCreated }));
registerMasterCreator('firmId', (typed, onCreated) => openNewPartyModal({ name: typed, type: 'FIRM', onCreated }));