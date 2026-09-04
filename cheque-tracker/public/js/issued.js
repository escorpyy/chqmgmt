import { api } from './api.js';
import { toast } from './toast.js';
import { state } from './state.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { openDrawer, closeDrawer } from './drawer.js';
import { escapeHtml, fmtDate, fmtMoney, fmtDateInput, humanize, statusTag, selectOptions, enumOptions, debounce } from './utils.js';
import { ISSUED_STATUSES, ISSUED_FOLLOWUP_RESPONSES, RETURN_REASONS, PAYMENT_METHODS, CLEARANCE_METHODS, PARTY_TYPES } from './constants.js';
import { loadDashboard } from './dashboard.js';
import { syncEditableSelect } from './combobox.js';

// ============================================================================
// ISSUED CHEQUES
// ============================================================================
export async function loadIssued() {
  const search = document.getElementById('issued-search').value;
  const status = document.getElementById('issued-status-filter').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  try {
    const cheques = await api(`/issued-cheques?${params.toString()}`);
    renderIssuedTable(cheques);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderIssuedTable(cheques) {
  const el = document.getElementById('issued-table');
  if (!cheques.length) {
    el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No issued cheques match. Try clearing filters, or issue a new cheque.</td></tr></tbody></table>`;
    return;
  }
  el.innerHTML = `
    <table class="ledger">
      <thead><tr>
        <th>Cheque no</th><th>Payee</th><th>Our account</th>
        <th>Cheque date</th><th>Amount</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${cheques.map((c) => `
          <tr data-id="${c.id}">
            <td class="num">${escapeHtml(c.chqNo)}</td>
            <td>${escapeHtml(c.payeeName)}</td>
            <td>${escapeHtml(c.companyBankAccount?.bank?.name || '—')}</td>
            <td>${fmtDate(c.chqDate)}</td>
            <td class="amount">${fmtMoney(c.amount)}</td>
            <td>${statusTag(c.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('tr[data-id]').forEach((row) => {
    row.addEventListener('click', () => openIssuedDetail(row.dataset.id));
  });
}

document.getElementById('issued-search').addEventListener('input', debounce(loadIssued, 300));
document.getElementById('issued-status-filter').addEventListener('change', loadIssued);

document.getElementById('btn-new-issued').addEventListener('click', () => openNewIssuedModal());

function openNewIssuedModal() {
  const body = `
    <form id="form-new-issued">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Our bank account *</label>
          <select name="companyBankAccountId" required>${selectOptions(state.accounts, 'id', (a) => `${a.accountName} — ${a.bank?.name || ''}`, 'Select account…')}</select>
        </div>
        <div class="field">
          <label>Cheque no *</label>
          <input name="chqNo" type="text" required>
        </div>
        <div class="field">
          <label>Cheque date *</label>
          <input name="chqDate" type="date" required>
        </div>
        <div class="field span-2">
          <label>Payee party (optional)</label>
          <select name="payeeId">${selectOptions(state.parties, 'id', (p) => p.name, 'Not in party list')}</select>
        </div>
        <div class="field">
          <label>Payee name on cheque *</label>
          <input name="payeeName" type="text" required>
        </div>
        <div class="field">
          <label>Payee type *</label>
          <select name="payeeType" required>${enumOptions(PARTY_TYPES)}</select>
        </div>
        <div class="field">
          <label>Amount *</label>
          <input name="amount" type="number" step="0.01" min="0.01" required>
        </div>
        <div class="field">
          <label>Issued by staff</label>
          <select name="issuedById">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
        </div>
        <div class="field span-2">
          <label>Purpose</label>
          <textarea name="purpose"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-issued">Cancel</button>
        <button type="submit" class="btn btn-primary">Save cheque</button>
      </div>
    </form>`;

  openModal('New issued cheque', body, {
    onMount: () => {
      const form = document.getElementById('form-new-issued');
      document.getElementById('cancel-new-issued').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        if (!data.payeeId) delete data.payeeId;
        try {
          await api('/issued-cheques', { method: 'POST', body: JSON.stringify(data) });
          toast('Issued cheque recorded', 'success');
          closeModal();
          loadIssued();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function openIssuedDetail(id) {
  try {
    const c = await api(`/issued-cheques/${id}`);
    renderIssuedDrawer(c);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderIssuedDrawer(c) {
  const canFollowUp = c.status === 'RETURNED';
  const canPay = !['CLEARED'].includes(c.status);
  const canCheckLog = c.status !== 'ON_CHECK';
  const canReplace = c.status === 'RETURNED' && !c.replacedBy;
  const canStop = ['ISSUED', 'FOLLOWUP'].includes(c.status);
  const openCheckLog = c.checkLogs.find((l) => !l.resolvedAt);

  const html = `
    <div class="drawer-header">
      <div>
        <h2>Issued cheque ${escapeHtml(c.chqNo)}</h2>
        <p class="hint" style="margin-top:0.2rem">${escapeHtml(c.payeeName)} · ${fmtDate(c.chqDate)}</p>
      </div>
      <button class="drawer-close" id="drawer-close-btn" aria-label="Close">×</button>
    </div>

    <div>${statusTag(c.status)} <span class="muted num" style="font-size:0.8rem">since ${fmtDate(c.statusDate)}${c.totalDays != null ? ` · ${c.totalDays}d` : ''}</span></div>

    <dl class="detail-grid">
      <div class="detail-field"><dt>Amount</dt><dd>Rs ${fmtMoney(c.amount)}</dd></div>
      <div class="detail-field"><dt>Our account</dt><dd>${escapeHtml(c.companyBankAccount?.accountName || '—')}</dd></div>
      <div class="detail-field"><dt>Bank</dt><dd>${escapeHtml(c.companyBankAccount?.bank?.name || '—')}</dd></div>
      <div class="detail-field"><dt>Payee type</dt><dd>${humanize(c.payeeType)}</dd></div>
      <div class="detail-field"><dt>Cheque type</dt><dd>${humanize(c.chequeType)}</dd></div>
      <div class="detail-field"><dt>Issued by</dt><dd>${escapeHtml(c.issuedBy?.name || '—')}</dd></div>
      ${c.purpose ? `<div class="detail-field"><dt>Purpose</dt><dd>${escapeHtml(c.purpose)}</dd></div>` : ''}
      ${c.clearanceMethod ? `<div class="detail-field"><dt>Cleared via</dt><dd>${humanize(c.clearanceMethod)}</dd></div>` : ''}
      ${c.returnReason ? `<div class="detail-field"><dt>Return reason</dt><dd>${humanize(c.returnReason)}</dd></div>` : ''}
      ${c.replaces ? `<div class="detail-field"><dt>Replaces</dt><dd class="num">${escapeHtml(c.replaces.chqNo)}</dd></div>` : ''}
      ${c.replacedBy ? `<div class="detail-field"><dt>Replaced by</dt><dd class="num">${escapeHtml(c.replacedBy.chqNo)}</dd></div>` : ''}
    </dl>

    <div class="action-row">
      <button class="btn btn-sm" data-action="status">Change status</button>
      ${canStop ? `<button class="btn btn-sm btn-danger" data-action="stop">Stop payment</button>` : ''}
      ${canFollowUp ? `<button class="btn btn-sm" data-action="followup">Log follow-up</button>` : ''}
      ${canPay ? `<button class="btn btn-sm" data-action="payment">Record settlement</button>` : ''}
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
        </div>`).join('') : `<p class="timeline-empty">No follow-ups logged yet.</p>`}
    </div>

    <div class="section-title">Settlements</div>
    <div class="timeline">
      ${c.payments.length ? c.payments.map((p) => `
        <div class="timeline-item payment">
          <div class="ti-head"><span>Rs ${fmtMoney(p.amount)} · ${humanize(p.method)}</span><span class="ti-meta">${fmtDate(p.paymentDate)}</span></div>
          ${p.referenceNo ? `<div class="ti-meta">Ref: ${escapeHtml(p.referenceNo)}</div>` : ''}
          ${p.note ? `<div>${escapeHtml(p.note)}</div>` : ''}
        </div>`).join('') : `<p class="timeline-empty">No settlements recorded yet.</p>`}
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
  wireIssuedActions(c);
}

function wireIssuedActions(c) {
  const root = document.getElementById('drawer-content');
  root.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'status') openIssuedStatusModal(c);
      if (action === 'stop') stopIssuedCheque(c);
      if (action === 'followup') openIssuedFollowUpModal(c);
      if (action === 'payment') openIssuedPaymentModal(c);
      if (action === 'checklog') openIssuedCheckLogModal(c);
      if (action === 'resolve-checklog') openIssuedResolveCheckLogModal(c, btn.dataset.logId);
      if (action === 'replace') openIssuedReplaceModal(c);
      if (action === 'edit') openIssuedEditModal(c);
      if (action === 'delete') deleteIssuedCheque(c);
    });
  });
}

function openIssuedEditModal(c) {
  const body = `
    <form id="form-edit-issued">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Amount *</label>
          <input name="amount" type="number" step="0.01" min="0.01" required value="${escapeHtml(c.amount)}">
        </div>
        <div class="field">
          <label>Issued by staff</label>
          <select name="issuedById">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
        </div>
        <div class="field span-2">
          <label>Purpose</label>
          <textarea name="purpose">${escapeHtml(c.purpose || '')}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-issued">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit issued cheque — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-issued');
      form.querySelector('[name="issuedById"]').value = c.issuedById || '';
      syncEditableSelect(form.querySelector('[name="issuedById"]'));
      document.getElementById('cancel-edit-issued').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/issued-cheques/${c.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Issued cheque updated', 'success');
          closeModal();
          openIssuedDetail(c.id);
          loadIssued();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteIssuedCheque(c) {
  const ok = await openConfirmModal(
    'Delete issued cheque?',
    `This removes cheque ${escapeHtml(c.chqNo)} from active lists. Its history is kept, not erased.`,
  );
  if (!ok) return;
  try {
    await api(`/issued-cheques/${c.id}`, { method: 'DELETE' });
    toast('Issued cheque deleted', 'success');
    closeDrawer();
    loadIssued();
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function stopIssuedCheque(c) {
  if (!confirm(`Mark cheque ${c.chqNo} as stopped? This cannot be undone from here.`)) return;
  try {
    await api(`/issued-cheques/${c.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'STOPPED' }) });
    toast('Payment stopped', 'success');
    openIssuedDetail(c.id);
    loadIssued();
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openIssuedStatusModal(c) {
  const body = `
    <form id="form-status">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>New status *</label>
          <select name="status" id="status-select" required>${enumOptions(ISSUED_STATUSES)}</select>
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
          await api(`/issued-cheques/${c.id}/status`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Status updated', 'success');
          closeModal();
          openIssuedDetail(c.id);
          loadIssued();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openIssuedFollowUpModal(c) {
  const body = `
    <form id="form-followup">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Response *</label>
          <select name="response" required>${enumOptions(ISSUED_FOLLOWUP_RESPONSES)}</select>
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
          await api(`/issued-cheques/${c.id}/followups`, { method: 'POST', body: JSON.stringify(data) });
          toast('Follow-up logged', 'success');
          closeModal();
          openIssuedDetail(c.id);
          loadIssued();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openIssuedPaymentModal(c) {
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
        <button type="submit" class="btn btn-primary">Record settlement</button>
      </div>
    </form>`;
  openModal(`Record settlement — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-payment');
      document.getElementById('cancel-payment').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/issued-cheques/${c.id}/payments`, { method: 'POST', body: JSON.stringify(data) });
          toast('Settlement recorded', 'success');
          closeModal();
          openIssuedDetail(c.id);
          loadIssued();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openIssuedCheckLogModal(c) {
  const body = `
    <form id="form-checklog">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Reason *</label>
          <textarea name="reason" required placeholder="e.g. cheque stub vs bank statement mismatch"></textarea>
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
          await api(`/issued-cheques/${c.id}/checklogs`, { method: 'POST', body: JSON.stringify(data) });
          toast('Cheque flagged for check', 'success');
          closeModal();
          openIssuedDetail(c.id);
          loadIssued();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openIssuedResolveCheckLogModal(c, logId) {
  const body = `
    <form id="form-resolve">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Actual status *</label>
          <select name="resolvedStatus" required>${enumOptions(ISSUED_STATUSES.filter((s) => s !== 'ON_CHECK'))}</select>
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
          await api(`/issued-cheques/${c.id}/checklogs/${logId}/resolve`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Check resolved', 'success');
          closeModal();
          openIssuedDetail(c.id);
          loadIssued();
          loadDashboard();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

function openIssuedReplaceModal(c) {
  const body = `
    <form id="form-replace">
      <div class="form-error"></div>
      <p class="hint">Same payee carries over automatically.</p>
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
          <label>Our account</label>
          <select name="companyBankAccountId">${selectOptions(state.accounts, 'id', (a) => a.accountName, 'Same as original')}</select>
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
        if (!data.companyBankAccountId) delete data.companyBankAccountId;
        try {
          const replacement = await api(`/issued-cheques/${c.id}/replace`, { method: 'POST', body: JSON.stringify(data) });
          toast('Replacement cheque created', 'success');
          closeModal();
          openIssuedDetail(replacement.id);
          loadIssued();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}
