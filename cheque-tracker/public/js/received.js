import { api } from './api.js';
import { toast } from './toast.js';
import { state } from './state.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { openDrawer, closeDrawer } from './drawer.js';
import { escapeHtml, fmtDate, fmtMoney, fmtDateInput, humanize, statusTag, selectOptions, enumOptions, debounce } from './utils.js';
import { RECEIVED_STATUSES, FOLLOWUP_RESPONSES, RETURN_REASONS, PAYMENT_METHODS, CLEARANCE_METHODS, PARTY_TYPES } from './constants.js';
import { loadDashboard } from './dashboard.js';
import { syncEditableSelect } from './combobox.js';

// ============================================================================
// RECEIVED CHEQUES
// ============================================================================
export async function loadReceived() {
  const search = document.getElementById('received-search').value;
  const status = document.getElementById('received-status-filter').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  try {
    const cheques = await api(`/cheques?${params.toString()}`);
    renderReceivedTable(cheques);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderReceivedTable(cheques) {
  const el = document.getElementById('received-table');
  if (!cheques.length) {
    el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No cheques match. Try clearing filters, or record a new cheque.</td></tr></tbody></table>`;
    return;
  }
  el.innerHTML = `
    <table class="ledger">
      <thead><tr>
        <th>Cheque no</th><th>Ref no</th><th>Issuer</th><th>Bank</th>
        <th>Cheque date</th><th>Amount</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${cheques.map((c) => `
          <tr data-id="${c.id}">
            <td class="num">${escapeHtml(c.chqNo)}</td>
            <td class="num muted">${escapeHtml(c.refNo || '—')}</td>
            <td>${escapeHtml(c.issuer?.name || '—')}</td>
            <td>${escapeHtml(c.bank?.name || '—')}</td>
            <td>${fmtDate(c.chqDate)}</td>
            <td class="amount">${fmtMoney(c.amount)}</td>
            <td>${statusTag(c.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('tr[data-id]').forEach((row) => {
    row.addEventListener('click', () => openChequeDetail(row.dataset.id));
  });
}

document.getElementById('received-search').addEventListener('input', debounce(loadReceived, 300));
document.getElementById('received-status-filter').addEventListener('change', loadReceived);

document.getElementById('btn-new-cheque').addEventListener('click', () => openNewChequeModal());

function openNewChequeModal() {
  const body = `
    <form id="form-new-cheque">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Fiscal year *</label>
          <select name="fiscalYearId" required>${selectOptions(state.fiscalYears, 'id', (f) => f.year, 'Select fiscal year…')}</select>
        </div>
        <div class="field">
          <label>Receipt no.</label>
          <input name="receiptNo" type="text" placeholder="UR-001">
        </div>
        <div class="field">
          <label>Ref no</label>
          <input name="refNo" type="text" placeholder="URT-001/01">
        </div>
        <div class="field">
          <label>Cheque no *</label>
          <input name="chqNo" type="text" required>
        </div>
        <div class="field span-2">
          <label>Issuer (party) *</label>
          <select name="issuerId" required>${selectOptions(state.parties, 'id', (p) => `${p.name} (${humanize(p.type)})`, 'Select issuer…')}</select>
        </div>
        <div class="field">
          <label>Payee name on cheque *</label>
          <input name="issuedOn" type="text" required>
        </div>
        <div class="field">
          <label>Payee type *</label>
          <select name="issuedOnType" required>${enumOptions(PARTY_TYPES)}</select>
        </div>
        <div class="field">
          <label>Cheque date *</label>
          <input name="chqDate" type="date" required>
        </div>
        <div class="field">
          <label>Amount *</label>
          <input name="amount" type="number" step="0.01" min="0.01" required>
        </div>
        <div class="field">
          <label>Drawee bank *</label>
          <select name="bankId" required>${selectOptions(state.banks, 'id', (b) => b.name, 'Select bank…')}</select>
        </div>
        <div class="field">
          <label>Presented at bank</label>
          <select name="presentedBankId">${selectOptions(state.banks, 'id', (b) => b.name, 'Same as drawee bank')}</select>
        </div>
        <div class="field span-2">
          <label>Handled by staff</label>
          <select name="staffId">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-cheque">Cancel</button>
        <button type="submit" class="btn btn-primary">Save cheque</button>
      </div>
    </form>`;

  openModal('New received cheque', body, {
    onMount: () => {
      const form = document.getElementById('form-new-cheque');
      document.getElementById('cancel-new-cheque').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/cheques', { method: 'POST', body: JSON.stringify(data) });
          toast('Cheque recorded', 'success');
          closeModal();
          loadReceived();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

export async function openChequeDetail(id) {
  try {
    const c = await api(`/cheques/${id}`);
    renderChequeDrawer(c);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderChequeDrawer(c) {
  const canFollowUp = ['PENDING', 'FOLLOWUP'].includes(c.status);
  const canPay = !['CLEARED'].includes(c.status);
  const canCheckLog = c.status !== 'ON_CHECK';
  const canReplace = c.status === 'RETURNED' && !c.replacedBy;
  const openCheckLog = c.checkLogs.find((l) => !l.resolvedAt);

  const html = `
    <div class="drawer-header">
      <div>
        <h2>Cheque ${escapeHtml(c.chqNo)}</h2>
        <p class="hint" style="margin-top:0.2rem">${escapeHtml(c.issuer?.name || '')} · ${fmtDate(c.chqDate)}</p>
      </div>
      <button class="drawer-close" id="drawer-close-btn" aria-label="Close">×</button>
    </div>

    <div>${statusTag(c.status)} <span class="muted num" style="font-size:0.8rem">since ${fmtDate(c.statusDate)}${c.totalDays != null ? ` · ${c.totalDays}d` : ''}</span></div>

    <dl class="detail-grid">
      <div class="detail-field"><dt>Ref no</dt><dd>${escapeHtml(c.refNo || '—')}</dd></div>
      <div class="detail-field"><dt>Receipt</dt><dd>${escapeHtml(c.fiscalYear?.year || '')} ${escapeHtml(c.receiptNo || '')}</dd></div>
      <div class="detail-field"><dt>Amount</dt><dd>Rs ${fmtMoney(c.amount)}</dd></div>
      <div class="detail-field"><dt>Payee on cheque</dt><dd>${escapeHtml(c.issuedOn)} (${humanize(c.issuedOnType)})</dd></div>
      <div class="detail-field"><dt>Cheque type</dt><dd>${humanize(c.chequeType)}</dd></div>
      <div class="detail-field"><dt>Drawee bank</dt><dd>${escapeHtml(c.bank?.name || '—')}</dd></div>
      <div class="detail-field"><dt>Presented bank</dt><dd>${escapeHtml(c.presentedBank?.name || '—')}</dd></div>
      <div class="detail-field"><dt>Handled by</dt><dd>${escapeHtml(c.staff?.name || '—')}</dd></div>
      ${c.clearanceMethod ? `<div class="detail-field"><dt>Cleared via</dt><dd>${humanize(c.clearanceMethod)}</dd></div>` : ''}
      ${c.returnReason ? `<div class="detail-field"><dt>Return reason</dt><dd>${humanize(c.returnReason)}</dd></div>` : ''}
      ${c.replaces ? `<div class="detail-field"><dt>Replaces</dt><dd class="num">${escapeHtml(c.replaces.chqNo)}</dd></div>` : ''}
      ${c.replacedBy ? `<div class="detail-field"><dt>Replaced by</dt><dd class="num">${escapeHtml(c.replacedBy.chqNo)}</dd></div>` : ''}
    </dl>

    <div class="action-row">
      <button class="btn btn-sm" data-action="status">Change status</button>
      ${canFollowUp ? `<button class="btn btn-sm" data-action="followup">Log follow-up</button>` : ''}
      ${canPay ? `<button class="btn btn-sm" data-action="payment">Record payment</button>` : ''}
      ${canCheckLog ? `<button class="btn btn-sm" data-action="checklog">Flag for check</button>` : ''}
      ${openCheckLog ? `<button class="btn btn-sm" data-action="resolve-checklog" data-log-id="${openCheckLog.id}">Resolve check</button>` : ''}
      ${canReplace ? `<button class="btn btn-sm" data-action="replace">Issue replacement</button>` : ''}
      <button class="btn btn-sm" data-action="edit">Edit details</button>
      <button class="btn btn-sm btn-danger" data-action="delete">Delete cheque</button>
    </div>

    <div class="section-title">Follow-ups</div>
    <div class="timeline">
      ${c.followUps.length ? c.followUps.map((f) => `
        <div class="timeline-item">
          <div class="ti-head"><span>${humanize(f.response)}</span><span class="ti-meta">${fmtDate(f.followUpDate)}</span></div>
          ${f.note ? `<div>${escapeHtml(f.note)}</div>` : ''}
          ${f.nextActionDate ? `<div class="ti-meta">Next action: ${fmtDate(f.nextActionDate)}</div>` : ''}
          ${f.staffId ? `<div class="ti-meta">by ${escapeHtml(state.staff.find((s) => s.id === f.staffId)?.name || '')}</div>` : ''}
        </div>`).join('') : `<p class="timeline-empty">No follow-ups logged yet.</p>`}
    </div>

    <div class="section-title">Payments</div>
    <div class="timeline">
      ${c.payments.length ? c.payments.map((p) => `
        <div class="timeline-item payment">
          <div class="ti-head"><span>Rs ${fmtMoney(p.amount)} · ${humanize(p.method)}</span><span class="ti-meta">${fmtDate(p.paymentDate)}</span></div>
          ${p.referenceNo ? `<div class="ti-meta">Ref: ${escapeHtml(p.referenceNo)}</div>` : ''}
          ${p.note ? `<div>${escapeHtml(p.note)}</div>` : ''}
        </div>`).join('') : `<p class="timeline-empty">No payments recorded yet.</p>`}
    </div>

    <div class="section-title">Check log</div>
    <div class="timeline">
      ${c.checkLogs.length ? c.checkLogs.map((l) => `
        <div class="timeline-item checklog">
          <div class="ti-head"><span>${l.resolvedAt ? `Resolved → ${humanize(l.resolvedStatus)}` : 'Open investigation'}</span><span class="ti-meta">${fmtDate(l.raisedAt)}</span></div>
          <div>${escapeHtml(l.reason)}</div>
          ${l.resolutionNote ? `<div class="ti-meta">${escapeHtml(l.resolutionNote)}</div>` : ''}
        </div>`).join('') : `<p class="timeline-empty">Never flagged for manual re-verification.</p>`}
    </div>
  `;

  openDrawer(html);
  document.getElementById('drawer-close-btn').addEventListener('click', closeDrawer);
  wireChequeActions(c);
}

function wireChequeActions(c) {
  const root = document.getElementById('drawer-content');
  root.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'status') openChequeStatusModal(c);
      if (action === 'followup') openChequeFollowUpModal(c);
      if (action === 'payment') openChequePaymentModal(c);
      if (action === 'checklog') openChequeCheckLogModal(c);
      if (action === 'resolve-checklog') openChequeResolveCheckLogModal(c, btn.dataset.logId);
      if (action === 'replace') openChequeReplaceModal(c);
      if (action === 'edit') openChequeEditModal(c);
      if (action === 'delete') deleteCheque(c);
    });
  });
}

function openChequeEditModal(c) {
  const body = `
    <form id="form-edit-cheque">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Fiscal year *</label>
          <select name="fiscalYearId" required>${selectOptions(state.fiscalYears, 'id', (f) => f.year, 'Select fiscal year…')}</select>
        </div>
        <div class="field">
          <label>Receipt no.</label>
          <input name="receiptNo" type="text" value="${escapeHtml(c.receiptNo || '')}">
        </div>
        <div class="field">
          <label>Ref no</label>
          <input name="refNo" type="text" value="${escapeHtml(c.refNo || '')}">
        </div>
        <div class="field">
          <label>Amount *</label>
          <input name="amount" type="number" step="0.01" min="0.01" required value="${escapeHtml(c.amount)}">
        </div>
        <div class="field">
          <label>Presented at bank</label>
          <select name="presentedBankId">${selectOptions(state.banks, 'id', (b) => b.name, 'Same as drawee bank')}</select>
        </div>
        <div class="field">
          <label>Handled by staff</label>
          <select name="staffId">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
        </div>
      </div>

      <div class="section-title" style="margin-top:1rem">Risky fields</div>
      <p class="hint" style="margin-top:0">These affect the bank/cheque-no uniqueness check and the lifecycle day-count. You'll be asked to confirm if you change any of them.</p>
      <div class="form-grid">
        <div class="field">
          <label>Cheque date *</label>
          <input name="chqDate" type="date" required value="${fmtDateInput(c.chqDate)}">
        </div>
        <div class="field">
          <label>Cheque no *</label>
          <input name="chqNo" type="text" required value="${escapeHtml(c.chqNo)}">
        </div>
        <div class="field">
          <label>Drawee bank *</label>
          <select name="bankId" required>${selectOptions(state.banks, 'id', (b) => b.name, 'Select bank…')}</select>
        </div>
        <div class="field">
          <label>Payee type *</label>
          <select name="issuedOnType" required>${enumOptions(PARTY_TYPES)}</select>
        </div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-cheque">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit cheque — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-cheque');
      form.querySelector('[name="fiscalYearId"]').value = c.fiscalYearId || '';
      syncEditableSelect(form.querySelector('[name="fiscalYearId"]'));
      form.querySelector('[name="presentedBankId"]').value = c.presentedBankId || '';
      syncEditableSelect(form.querySelector('[name="presentedBankId"]'));
      form.querySelector('[name="staffId"]').value = c.staffId || '';
      syncEditableSelect(form.querySelector('[name="staffId"]'));
      form.querySelector('[name="bankId"]').value = c.bankId;
      syncEditableSelect(form.querySelector('[name="bankId"]'));
      form.querySelector('[name="issuedOnType"]').value = c.issuedOnType;
      document.getElementById('cancel-edit-cheque').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());

        const riskyChanged = data.chqDate !== fmtDateInput(c.chqDate)
          || data.chqNo !== c.chqNo
          || data.bankId !== c.bankId
          || data.issuedOnType !== c.issuedOnType;
        if (riskyChanged) {
          const ok = await openConfirmModal(
            'Change risky fields?',
            'You\'re changing the cheque date, cheque no, drawee bank, or payee type. These affect the uniqueness check and the lifecycle day-count for this cheque. Continue?',
            { confirmLabel: 'Save changes', danger: false },
          );
          if (!ok) return;
        }

        try {
          await api(`/cheques/${c.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Cheque updated', 'success');
          closeModal();
          openChequeDetail(c.id);
          loadReceived();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteCheque(c) {
  const ok = await openConfirmModal(
    'Delete cheque?',
    `This removes cheque ${escapeHtml(c.chqNo)} from active lists. Its history is kept, not erased.`,
  );
  if (!ok) return;
  try {
    await api(`/cheques/${c.id}`, { method: 'DELETE' });
    toast('Cheque deleted', 'success');
    closeDrawer();
    loadReceived();
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openChequeStatusModal(c) {
  const body = `
    <form id="form-status">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>New status *</label>
          <select name="status" id="status-select" required>${enumOptions(RECEIVED_STATUSES)}</select>
        </div>
        <div class="field span-2">
          <label>Status date *</label>
          <input name="statusDate" type="date" id="status-date-input" required value="${fmtDateInput(c.statusDate)}" min="${fmtDateInput(c.chqDate)}">
          <span class="hint">Total lifecycle (status date − cheque date) is recalculated from this.</span>
        </div>
        <div class="field span-2" id="clearance-field" style="display:none">
          <label>Clearance method</label>
          <select name="clearanceMethod">${enumOptions(CLEARANCE_METHODS)}</select>
        </div>
        <div class="field" id="return-reason-field" style="display:none">
          <label>Return reason</label>
          <select name="returnReason">${enumOptions(RETURN_REASONS)}</select>
        </div>
        <div class="field span-2" id="return-note-field" style="display:none">
          <label>Return note</label>
          <textarea name="returnNote"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-status">Cancel</button>
        <button type="submit" class="btn btn-primary">Update status</button>
      </div>
    </form>`;
  openModal(`Update status — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-status');
      const select = document.getElementById('status-select');
      select.value = c.status;
      const toggleFields = () => {
        document.getElementById('clearance-field').style.display = select.value === 'CLEARED' ? '' : 'none';
        const isReturned = select.value === 'RETURNED';
        document.getElementById('return-reason-field').style.display = isReturned ? '' : 'none';
        document.getElementById('return-note-field').style.display = isReturned ? '' : 'none';
      };
      select.addEventListener('change', toggleFields);
      toggleFields();
      document.getElementById('cancel-status').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/cheques/${c.id}/status`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Status updated', 'success');
          closeModal();
          openChequeDetail(c.id);
          loadReceived();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openChequeFollowUpModal(c) {
  const body = `
    <form id="form-followup">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Response *</label>
          <select name="response" required>${enumOptions(FOLLOWUP_RESPONSES)}</select>
        </div>
        <div class="field">
          <label>Follow-up date</label>
          <input name="followUpDate" type="date" value="${fmtDateInput(new Date())}">
        </div>
        <div class="field">
          <label>Next action date</label>
          <input name="nextActionDate" type="date">
        </div>
        <div class="field span-2">
          <label>Staff</label>
          <select name="staffId">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
        </div>
        <div class="field span-2">
          <label>Note</label>
          <textarea name="note"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-followup">Cancel</button>
        <button type="submit" class="btn btn-primary">Log follow-up</button>
      </div>
    </form>`;
  openModal(`Log follow-up — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-followup');
      document.getElementById('cancel-followup').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/cheques/${c.id}/followups`, { method: 'POST', body: JSON.stringify(data) });
          toast('Follow-up logged', 'success');
          closeModal();
          openChequeDetail(c.id);
          loadReceived();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openChequePaymentModal(c) {
  const alreadyPaid = c.payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Number(c.amount) - alreadyPaid;
  const body = `
    <form id="form-payment">
      <div class="form-error"></div>
      <p class="hint">Remaining balance: Rs ${fmtMoney(remaining)}</p>
      <div class="form-grid">
        <div class="field">
          <label>Amount *</label>
          <input name="amount" type="number" step="0.01" min="0.01" max="${remaining}" required>
        </div>
        <div class="field">
          <label>Method *</label>
          <select name="method" required>${enumOptions(PAYMENT_METHODS)}</select>
        </div>
        <div class="field">
          <label>Payment date</label>
          <input name="paymentDate" type="date" value="${fmtDateInput(new Date())}">
        </div>
        <div class="field">
          <label>Reference no</label>
          <input name="referenceNo" type="text">
        </div>
        <div class="field span-2">
          <label>Staff</label>
          <select name="staffId">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
        </div>
        <div class="field span-2">
          <label>Note</label>
          <textarea name="note"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-payment">Cancel</button>
        <button type="submit" class="btn btn-primary">Record payment</button>
      </div>
    </form>`;
  openModal(`Record payment — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-payment');
      document.getElementById('cancel-payment').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/cheques/${c.id}/payments`, { method: 'POST', body: JSON.stringify(data) });
          toast('Payment recorded', 'success');
          closeModal();
          openChequeDetail(c.id);
          loadReceived();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openChequeCheckLogModal(c) {
  const body = `
    <form id="form-checklog">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Reason *</label>
          <textarea name="reason" required placeholder="e.g. not updated since last month, needs manual re-verification"></textarea>
        </div>
        <div class="field span-2">
          <label>Raised by</label>
          <select name="raisedById">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-checklog">Cancel</button>
        <button type="submit" class="btn btn-primary">Flag for check</button>
      </div>
    </form>`;
  openModal(`Flag for manual check — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-checklog');
      document.getElementById('cancel-checklog').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/cheques/${c.id}/checklogs`, { method: 'POST', body: JSON.stringify(data) });
          toast('Cheque flagged for check', 'success');
          closeModal();
          openChequeDetail(c.id);
          loadReceived();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openChequeResolveCheckLogModal(c, logId) {
  const body = `
    <form id="form-resolve">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Actual status *</label>
          <select name="resolvedStatus" required>${enumOptions(RECEIVED_STATUSES.filter((s) => s !== 'ON_CHECK'))}</select>
        </div>
        <div class="field span-2">
          <label>Resolution note</label>
          <textarea name="resolutionNote" placeholder="What did you find out?"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-resolve">Cancel</button>
        <button type="submit" class="btn btn-primary">Resolve</button>
      </div>
    </form>`;
  openModal(`Resolve check — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-resolve');
      document.getElementById('cancel-resolve').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/cheques/${c.id}/checklogs/${logId}/resolve`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Check resolved', 'success');
          closeModal();
          openChequeDetail(c.id);
          loadReceived();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openChequeReplaceModal(c) {
  const body = `
    <form id="form-replace">
      <div class="form-error"></div>
      <p class="hint">Same fiscal year, receipt no., issuer and payee carry over automatically.</p>
      <div class="form-grid">
        <div class="field">
          <label>New cheque no *</label>
          <input name="chqNo" type="text" required>
        </div>
        <div class="field">
          <label>New cheque date *</label>
          <input name="chqDate" type="date" required>
        </div>
        <div class="field">
          <label>Amount</label>
          <input name="amount" type="number" step="0.01" min="0.01" value="${c.amount}">
        </div>
        <div class="field">
          <label>Drawee bank</label>
          <select name="bankId">${selectOptions(state.banks, 'id', (b) => b.name, 'Same as original')}</select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-replace">Cancel</button>
        <button type="submit" class="btn btn-primary">Create replacement</button>
      </div>
    </form>`;
  openModal(`Issue replacement — for ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-replace');
      document.getElementById('cancel-replace').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        if (!data.bankId) delete data.bankId;
        try {
          const replacement = await api(`/cheques/${c.id}/replace`, { method: 'POST', body: JSON.stringify(data) });
          toast('Replacement cheque created', 'success');
          closeModal();
          openChequeDetail(replacement.id);
          loadReceived();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}
