// ============================================================================
// Constants
// ============================================================================
const API = '/api';

const RECEIVED_STATUSES = ['PENDING', 'FOLLOWUP', 'ON_CHECK', 'PRESENTED', 'CLEARED', 'RETURNED'];
const ISSUED_STATUSES = ['ISSUED', 'FOLLOWUP', 'ON_CHECK', 'PRESENTED', 'CLEARED', 'RETURNED', 'STOPPED'];
const FOLLOWUP_RESPONSES = ['CONFIRMED', 'REQUESTED_DELAY', 'REQUESTED_REPLACEMENT', 'REQUESTED_PARTIAL_PAYMENT', 'REQUESTED_RETURN', 'UNREACHABLE', 'OTHER'];
const ISSUED_FOLLOWUP_RESPONSES = ['WILL_REPRESENT', 'REQUESTED_REPLACEMENT', 'REQUESTED_PARTIAL_PAYMENT', 'DISPUTE', 'UNREACHABLE', 'OTHER'];
const RETURN_REASONS = ['INSUFFICIENT_FUNDS', 'SIGNATURE_MISMATCH', 'ACCOUNT_CLOSED', 'STOPPED_BY_ISSUER', 'DATE_ISSUE', 'OTHER'];
const PAYMENT_METHODS = ['CASH', 'IPS', 'CIPS', 'QR', 'BANK_DEPOSIT', 'OTHER'];
const CLEARANCE_METHODS = ['PRESENTMENT', 'PARTIAL_RECOVERY'];
const PARTY_TYPES = ['FIRM', 'INDIVIDUAL'];

// ============================================================================
// State (reference data cached client-side; cheque lists reloaded per view)
// ============================================================================
const state = {
  parties: [],
  banks: [],
  staff: [],
  accounts: [],
  receipts: [],
};

// ============================================================================
// Small utilities
// ============================================================================
function humanize(value) {
  if (!value) return '—';
  return value.toString().toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return str.toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateInput(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function statusTag(status) {
  return `<span class="status-tag status-${status}">${humanize(status)}</span>`;
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const message = (body && body.error) ? body.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

function toast(message, type = '') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function selectOptions(items, valueKey, labelFn, placeholder) {
  const opts = [`<option value="">${placeholder || 'Select…'}</option>`];
  for (const item of items) {
    opts.push(`<option value="${escapeHtml(item[valueKey])}">${escapeHtml(labelFn(item))}</option>`);
  }
  return opts.join('');
}

function enumOptions(values, placeholder) {
  const opts = placeholder ? [`<option value="">${placeholder}</option>`] : [];
  for (const v of values) opts.push(`<option value="${v}">${humanize(v)}</option>`);
  return opts.join('');
}

// ============================================================================
// Tabs
// ============================================================================
const TAB_LOADERS = {
  dashboard: loadDashboard,
  received: loadReceived,
  issued: loadIssued,
  parties: loadParties,
  banks: loadBanks,
  accounts: loadAccounts,
  staff: loadStaff,
  receipts: loadReceipts,
};

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  activateTab(btn.dataset.tab);
});

function activateTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
  TAB_LOADERS[tab]?.();
}

// ============================================================================
// Modal
// ============================================================================
function openModal(titleHtml, bodyHtml, { onMount } = {}) {
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <h2>${titleHtml}</h2>
      <button class="modal-close" id="modal-close-btn" aria-label="Close">×</button>
    </div>
    ${bodyHtml}
  `;
  document.getElementById('modal').classList.add('open');
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  if (onMount) onMount();
}
function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.getElementById('modal-backdrop').classList.remove('open');
  document.getElementById('modal-content').innerHTML = '';
}
document.getElementById('modal-backdrop').addEventListener('click', closeModal);

function formError(form, message) {
  const el = form.querySelector('.form-error');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
}
function clearFormError(form) {
  const el = form.querySelector('.form-error');
  if (el) el.classList.remove('show');
}

// openConfirmModal: shows a confirmation dialog, resolves true/false with the user's choice.
function openConfirmModal(title, message, { confirmLabel = 'Delete', danger = true } = {}) {
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

// ============================================================================
// Drawer
// ============================================================================
function openDrawer(html) {
  document.getElementById('drawer-content').innerHTML = html;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
  setTimeout(() => { document.getElementById('drawer-content').innerHTML = ''; }, 250);
}
document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);

// ============================================================================
// Reference data
// ============================================================================
async function loadReferenceData() {
  const [parties, banks, staff, accounts, receipts] = await Promise.all([
    api('/parties'), api('/banks'), api('/staff'), api('/company-bank-accounts'), api('/receipts'),
  ]);
  state.parties = parties;
  state.banks = banks;
  state.staff = staff;
  state.accounts = accounts;
  state.receipts = receipts;
}

async function checkHealth() {
  const el = document.getElementById('db-status');
  try {
    const health = await api('/health');
    el.classList.toggle('ok', health.db === 'connected');
    el.classList.toggle('error', health.db !== 'connected');
    el.title = health.db === 'connected' ? 'Database connected' : 'Database disconnected';
  } catch {
    el.classList.add('error');
    el.title = 'Cannot reach the server';
  }
}

// ============================================================================
// Dashboard
// ============================================================================
async function loadDashboard() {
  const statEl = { rec: document.getElementById('stat-receivable'), pay: document.getElementById('stat-payable'), chk: document.getElementById('stat-oncheck') };
  try {
    const summary = await api('/dashboard/summary');
    const outstanding = (byStatus) => byStatus.filter((s) => !['CLEARED'].includes(s.status))
      .reduce((sum, s) => sum + Number(s.amount), 0);

    statEl.rec.textContent = fmtMoney(outstanding(summary.received.byStatus));
    statEl.pay.textContent = fmtMoney(outstanding(summary.issued.byStatus));
    statEl.chk.textContent = summary.openInvestigations.received + summary.openInvestigations.issued;

    renderStatusBreakdown('dash-received-status', summary.received.byStatus, RECEIVED_STATUSES);
    renderStatusBreakdown('dash-issued-status', summary.issued.byStatus, ISSUED_STATUSES);
  } catch (err) {
    toast(err.message, 'error');
  }

  try {
    const cheques = await api('/cheques');
    const attention = cheques
      .filter((c) => ['PENDING', 'FOLLOWUP'].includes(c.status))
      .sort((a, b) => new Date(a.chqDate) - new Date(b.chqDate))
      .slice(0, 8);
    renderAttentionTable(attention);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderStatusBreakdown(elId, byStatus, order) {
  const el = document.getElementById(elId);
  const maxCount = Math.max(1, ...byStatus.map((s) => s.count));
  const map = Object.fromEntries(byStatus.map((s) => [s.status, s]));
  el.innerHTML = order.map((status) => {
    const row = map[status] || { count: 0, amount: 0 };
    const pct = Math.round((row.count / maxCount) * 100);
    return `
      <div class="status-row status-${status}">
        ${statusTag(status)}
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="status-count">${row.count}</span>
        <span class="status-amount">Rs ${fmtMoney(row.amount)}</span>
      </div>`;
  }).join('');
}

function renderAttentionTable(cheques) {
  const el = document.getElementById('dash-attention-table');
  if (!cheques.length) {
    el.innerHTML = `<p class="hint">Nothing pending — every received cheque is past the initial follow-up stage.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="ledger">
      <thead><tr><th>Cheque no</th><th>Issuer</th><th>Cheque date</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>
        ${cheques.map((c) => `
          <tr data-id="${c.id}">
            <td class="num">${escapeHtml(c.chqNo)}</td>
            <td>${escapeHtml(c.issuer?.name || '—')}</td>
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

// ============================================================================
// RECEIVED CHEQUES
// ============================================================================
async function loadReceived() {
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
        <div class="field span-2">
          <label>Receipt *</label>
          <select name="receiptId" required>${selectOptions(state.receipts, 'id', (r) => `${r.fiscalYear} — ${r.receiptNo || 'no receipt no.'}`, 'Select receipt…')}</select>
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

async function openChequeDetail(id) {
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
      <div class="detail-field"><dt>Receipt</dt><dd>${escapeHtml(c.receipt?.fiscalYear || '')} ${escapeHtml(c.receipt?.receiptNo || '')}</dd></div>
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
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-cheque">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit cheque — ${escapeHtml(c.chqNo)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-cheque');
      form.querySelector('[name="presentedBankId"]').value = c.presentedBankId || '';
      form.querySelector('[name="staffId"]').value = c.staffId || '';
      document.getElementById('cancel-edit-cheque').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
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
      <p class="hint">Same receipt, issuer and payee carry over automatically.</p>
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

// ============================================================================
// ISSUED CHEQUES
// ============================================================================
async function loadIssued() {
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

// ============================================================================
// PARTIES
// ============================================================================
async function loadParties() {
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

document.getElementById('btn-new-party').addEventListener('click', () => {
  const body = `
    <form id="form-new-party">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Type *</label>
          <select name="type" required>${enumOptions(PARTY_TYPES)}</select>
        </div>
        <div class="field">
          <label>Name *</label>
          <input name="name" type="text" required>
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
      document.getElementById('cancel-new-party').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        if (!data.firmId) delete data.firmId;
        try {
          await api('/parties', { method: 'POST', body: JSON.stringify(data) });
          toast('Party saved', 'success');
          closeModal();
          await loadReferenceData();
          loadParties();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
});

// ============================================================================
// BANKS
// ============================================================================
async function loadBanks() {
  try {
    const banks = await api('/banks');
    const el = document.getElementById('banks-table');
    if (!banks.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No banks yet.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Bank</th><th>Branch</th><th>Received cheques</th><th>Our accounts</th><th></th></tr></thead>
        <tbody>
          ${banks.map((b) => `
            <tr data-id="${b.id}">
              <td>${escapeHtml(b.name)}</td>
              <td>${escapeHtml(b.branch || '—')}</td>
              <td class="num">${(b._count?.draweeCheques || 0)}</td>
              <td class="num">${(b._count?.companyAccounts || 0)}</td>
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
      const bank = banks.find((b) => b.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'edit') openEditBankModal(bank);
          if (action === 'delete') deleteBank(bank);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditBankModal(bank) {
  const body = `
    <form id="form-edit-bank">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Bank name *</label>
          <input name="name" type="text" required value="${escapeHtml(bank.name)}">
        </div>
        <div class="field span-2">
          <label>Branch</label>
          <input name="branch" type="text" value="${escapeHtml(bank.branch || '')}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-bank">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit bank — ${escapeHtml(bank.name)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-bank');
      document.getElementById('cancel-edit-bank').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/banks/${bank.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Bank updated', 'success');
          closeModal();
          await loadReferenceData();
          loadBanks();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteBank(bank) {
  const ok = await openConfirmModal(
    'Delete bank?',
    `${escapeHtml(bank.name)} will be permanently removed. This only works if no cheques or accounts reference it.`,
  );
  if (!ok) return;
  try {
    await api(`/banks/${bank.id}`, { method: 'DELETE' });
    toast('Bank deleted', 'success');
    await loadReferenceData();
    loadBanks();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-new-bank').addEventListener('click', () => {
  const body = `
    <form id="form-new-bank">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Bank name *</label>
          <input name="name" type="text" required>
        </div>
        <div class="field span-2">
          <label>Branch</label>
          <input name="branch" type="text">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-bank">Cancel</button>
        <button type="submit" class="btn btn-primary">Save bank</button>
      </div>
    </form>`;
  openModal('New bank', body, {
    onMount: () => {
      const form = document.getElementById('form-new-bank');
      document.getElementById('cancel-new-bank').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/banks', { method: 'POST', body: JSON.stringify(data) });
          toast('Bank saved', 'success');
          closeModal();
          await loadReferenceData();
          loadBanks();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
});

// ============================================================================
// COMPANY BANK ACCOUNTS
// ============================================================================
async function loadAccounts() {
  try {
    const accounts = await api('/company-bank-accounts');
    const el = document.getElementById('accounts-table');
    if (!accounts.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No accounts yet. Add the accounts cheques are issued from.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Account name</th><th>Bank</th><th>Account no.</th><th>Branch</th><th>Issued cheques</th><th></th></tr></thead>
        <tbody>
          ${accounts.map((a) => `
            <tr data-id="${a.id}">
              <td>${escapeHtml(a.accountName)}</td>
              <td>${escapeHtml(a.bank?.name || '—')}</td>
              <td class="num">${escapeHtml(a.accountNumber)}</td>
              <td>${escapeHtml(a.branch || '—')}</td>
              <td class="num">${(a._count?.issuedCheques || 0)}</td>
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
      const account = accounts.find((a) => a.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'edit') openEditAccountModal(account);
          if (action === 'delete') deleteAccount(account);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditAccountModal(account) {
  const body = `
    <form id="form-edit-account">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Bank *</label>
          <select name="bankId" required>${selectOptions(state.banks, 'id', (b) => b.name, 'Select bank…')}</select>
        </div>
        <div class="field span-2">
          <label>Account name *</label>
          <input name="accountName" type="text" required value="${escapeHtml(account.accountName)}">
        </div>
        <div class="field">
          <label>Account number *</label>
          <input name="accountNumber" type="text" required value="${escapeHtml(account.accountNumber)}">
        </div>
        <div class="field">
          <label>Branch</label>
          <input name="branch" type="text" value="${escapeHtml(account.branch || '')}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-account">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit account — ${escapeHtml(account.accountName)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-account');
      form.querySelector('[name="bankId"]').value = account.bankId || '';
      document.getElementById('cancel-edit-account').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/company-bank-accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Account updated', 'success');
          closeModal();
          await loadReferenceData();
          loadAccounts();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

async function deleteAccount(account) {
  const ok = await openConfirmModal(
    'Delete account?',
    `${escapeHtml(account.accountName)} will be permanently removed. This only works if no issued cheques reference it.`,
  );
  if (!ok) return;
  try {
    await api(`/company-bank-accounts/${account.id}`, { method: 'DELETE' });
    toast('Account deleted', 'success');
    await loadReferenceData();
    loadAccounts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-new-account').addEventListener('click', () => {
  const body = `
    <form id="form-new-account">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Bank *</label>
          <select name="bankId" required>${selectOptions(state.banks, 'id', (b) => b.name, 'Select bank…')}</select>
        </div>
        <div class="field span-2">
          <label>Account name *</label>
          <input name="accountName" type="text" required placeholder="e.g. B Enterprises Pvt. Ltd.">
        </div>
        <div class="field">
          <label>Account number *</label>
          <input name="accountNumber" type="text" required>
        </div>
        <div class="field">
          <label>Branch</label>
          <input name="branch" type="text">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-account">Cancel</button>
        <button type="submit" class="btn btn-primary">Save account</button>
      </div>
    </form>`;
  openModal('New company bank account', body, {
    onMount: () => {
      const form = document.getElementById('form-new-account');
      document.getElementById('cancel-new-account').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/company-bank-accounts', { method: 'POST', body: JSON.stringify(data) });
          toast('Account saved', 'success');
          closeModal();
          await loadReferenceData();
          loadAccounts();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
});

// ============================================================================
// STAFF
// ============================================================================
async function loadStaff() {
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

// ============================================================================
// RECEIPTS
// ============================================================================
async function loadReceipts() {
  try {
    const receipts = await api('/receipts');
    const el = document.getElementById('receipts-table');
    if (!receipts.length) {
      el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No receipts yet.</td></tr></tbody></table>`;
      return;
    }
    el.innerHTML = `
      <table class="ledger">
        <thead><tr><th>Fiscal year</th><th>Receipt no.</th><th>Cheques</th><th></th></tr></thead>
        <tbody>
          ${receipts.map((r) => `
            <tr data-id="${r.id}">
              <td class="num">${escapeHtml(r.fiscalYear)}</td>
              <td class="num">${escapeHtml(r.receiptNo || '—')}</td>
              <td class="num">${(r._count?.cheques || 0)}</td>
              <td class="row-actions">
                <div class="row-actions-group">
                  <button class="btn btn-sm" data-action="edit">Edit</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    el.querySelectorAll('tr[data-id]').forEach((row) => {
      const receipt = receipts.find((r) => r.id === row.dataset.id);
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.dataset.action === 'edit') openEditReceiptModal(receipt);
        });
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditReceiptModal(receipt) {
  const body = `
    <form id="form-edit-receipt">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Fiscal year *</label>
          <input name="fiscalYear" type="text" required value="${escapeHtml(receipt.fiscalYear)}">
        </div>
        <div class="field">
          <label>Receipt no.</label>
          <input name="receiptNo" type="text" value="${escapeHtml(receipt.receiptNo || '')}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-edit-receipt">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>`;
  openModal(`Edit receipt — ${escapeHtml(receipt.fiscalYear)}`, body, {
    onMount: () => {
      const form = document.getElementById('form-edit-receipt');
      document.getElementById('cancel-edit-receipt').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/receipts/${receipt.id}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Receipt updated', 'success');
          closeModal();
          await loadReferenceData();
          loadReceipts();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
}

document.getElementById('btn-new-receipt').addEventListener('click', () => {
  const body = `
    <form id="form-new-receipt">
      <div class="form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label>Fiscal year *</label>
          <input name="fiscalYear" type="text" required placeholder="2083/84">
        </div>
        <div class="field">
          <label>Receipt no.</label>
          <input name="receiptNo" type="text" placeholder="UR-001">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="cancel-new-receipt">Cancel</button>
        <button type="submit" class="btn btn-primary">Save receipt</button>
      </div>
    </form>`;
  openModal('New receipt', body, {
    onMount: () => {
      const form = document.getElementById('form-new-receipt');
      document.getElementById('cancel-new-receipt').addEventListener('click', closeModal);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormError(form);
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/receipts', { method: 'POST', body: JSON.stringify(data) });
          toast('Receipt saved', 'success');
          closeModal();
          await loadReferenceData();
          loadReceipts();
        } catch (err) {
          formError(form, err.message);
        }
      });
    },
  });
});

// ============================================================================
// Misc helpers
// ============================================================================
function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeDrawer();
  }
});

// ============================================================================
// Boot
// ============================================================================
(async function init() {
  await checkHealth();
  try {
    await loadReferenceData();
  } catch (err) {
    toast(`Could not load reference data: ${err.message}`, 'error');
  }
  loadDashboard();
})();
