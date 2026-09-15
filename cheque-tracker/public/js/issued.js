import { api } from './api.js';
import { toast } from './toast.js';
import { state } from './state.js';
import { openModal, closeModal, formError, clearFormError, openConfirmModal } from './modal.js';
import { openDrawer, closeDrawer } from './drawer.js';
import { escapeHtml, fmtDate, fmtDateStacked, fmtMoney, fmtDateInput, humanize, statusTag, selectOptions, enumOptions, debounce, ageTag, paginationControls, wirePaginationControls } from './utils.js';
import { ISSUED_STATUSES, ISSUED_FOLLOWUP_RESPONSES, RETURN_REASONS, PAYMENT_METHODS, CLEARANCE_METHODS, PARTY_TYPES, PAYEE_CATEGORIES } from './constants.js';
import { loadDashboard } from './dashboard.js';
import { syncEditableSelect } from './combobox.js';
import { syncBsDatePicker } from './bsDatePicker.js';
import { toolbarHtml, wireToolbar, setToolbarState, copyRecordToClipboard, readRecordFromClipboard } from './formToolbar.js';

// ============================================================================
// ISSUED CHEQUES
// ============================================================================
const PAGE_SIZE = 50;
let issuedPage = 1;
let fyFilterPopulated = false;
const DEFAULT_ISSUED_SORT = [{ field: 'chqDate', dir: 'desc' }];
// Same multi-level, 3-state sort stack as received.js — see the comments
// there. Clicking a new column appends a tie-breaker level; clicking one
// already in the stack toggles asc -> desc -> off. Only "Clear filters"
// resets it.
let issuedSort = DEFAULT_ISSUED_SORT.map((s) => ({ ...s }));

// Record-navigator cache for the Prev/Next arrows in the issued cheque form
// modal — same scheme as received.js's receivedNav* (see the comment there).
let issuedNavParams = null;
let issuedNavTotal = 0;
let issuedNavPages = new Map();

// Column definitions for the sortable headers — label plus the backend
// sort field (see the allowedFields list in routes/issuedCheques.js;
// relation fields use dot notation, any depth — e.g.
// "companyBankAccount.bank.name"). `null` field = not sortable.
const ISSUED_COLUMNS = [
  { label: 'Cheque no', field: 'chqNo' },
  { label: 'Cheque date', field: 'chqDate' },
  { label: 'Vendor', field: 'payeeName' },
  { label: 'Purpose', field: 'purpose' },
  { label: 'Bank name', field: 'companyBankAccount.bank.name' },
  { label: 'Amount', field: 'amount' },
  { label: 'Status', field: 'status' },
  { label: 'Status date', field: 'statusDate' },
  { label: 'Days outstanding', field: 'totalDays' },
  { label: 'Authority', field: null },
  { label: 'Actions', field: null },
];

function sortableHeaderRow() {
  return ISSUED_COLUMNS.map(({ label, field }) => {
    if (!field) return `<th>${label}</th>`;
    const level = issuedSort.findIndex((s) => s.field === field);
    if (level === -1) return `<th class="sortable" data-sort-field="${field}">${label}</th>`;
    const arrow = issuedSort[level].dir === 'asc' ? '▲' : '▼';
    const badge = issuedSort.length > 1 ? `<sup>${level + 1}</sup>` : '';
    return `<th class="sortable sort-active" data-sort-field="${field}">${label} ${arrow}${badge}</th>`;
  }).join('');
}

// Same rationale as received.js's populateFyFilter — safe to call on
// every load, only actually populates once per session.
function populateFyFilter() {
  const select = document.getElementById('issued-fy-filter');
  if (fyFilterPopulated || !state.fiscalYears.length) return;
  const current = select.value;
  select.innerHTML = `<option value="">All fiscal years</option>` +
    state.fiscalYears.map((f) => `<option value="${f.id}">${escapeHtml(f.year)}</option>`).join('');
  select.value = current;
  fyFilterPopulated = true;
}

// Everything that defines "which issued cheques, in what order" — shared by
// loadIssued (the table) and the nav-cache fetchers below (the form modal's
// Prev/Next). See received.js's buildReceivedFilterParams for the rationale.
function buildIssuedFilterParams() {
  const search = document.getElementById('issued-search').value.trim();
  const status = document.getElementById('issued-status-filter').value;
  const fiscalYearId = document.getElementById('issued-fy-filter').value;
  const dateFrom = document.getElementById('issued-date-from').value;
  const dateTo = document.getElementById('issued-date-to').value;
  const amountMin = document.getElementById('issued-amount-min').value;
  const amountMax = document.getElementById('issued-amount-max').value;
  const transfers = document.getElementById('issued-transfers-filter').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (fiscalYearId) params.set('fiscalYearId', fiscalYearId);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (amountMin !== '') params.set('amountMin', amountMin);
  if (amountMax !== '') params.set('amountMax', amountMax);
  if (transfers) params.set('transfers', transfers);
  params.set('sort', issuedSort.map((s) => `${s.field}:${s.dir}`).join(','));
  return params;
}

export async function loadIssued(page = issuedPage) {
  populateFyFilter();
  const filterParams = buildIssuedFilterParams();
  const filterKey = filterParams.toString();
  const params = new URLSearchParams(filterParams);
  params.set('page', page);
  params.set('pageSize', PAGE_SIZE);

  try {
    const { cheques, total } = await api(`/issued-cheques?${params.toString()}`);
    issuedPage = page;
    if (filterKey !== issuedNavParams) {
      issuedNavParams = filterKey;
      issuedNavPages = new Map();
    }
    issuedNavTotal = total;
    issuedNavPages.set(page, cheques.map((c) => c.id));
    renderIssuedTable(cheques, total, page);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function fetchIssuedNavPage(page) {
  if (issuedNavPages.has(page)) return issuedNavPages.get(page);
  const params = new URLSearchParams(issuedNavParams || buildIssuedFilterParams());
  params.set('page', page);
  params.set('pageSize', PAGE_SIZE);
  const { cheques, total } = await api(`/issued-cheques?${params.toString()}`);
  issuedNavTotal = total;
  const ids = cheques.map((c) => c.id);
  issuedNavPages.set(page, ids);
  return ids;
}

function issuedIndexOf(id) {
  for (const [page, ids] of issuedNavPages) {
    const offset = ids.indexOf(id);
    if (offset !== -1) return (page - 1) * PAGE_SIZE + offset;
  }
  return -1;
}

async function issuedIdAtIndex(index) {
  if (index < 0 || index >= issuedNavTotal) return null;
  const page = Math.floor(index / PAGE_SIZE) + 1;
  const offset = index % PAGE_SIZE;
  const ids = await fetchIssuedNavPage(page);
  return ids[offset] ?? null;
}

function renderIssuedTable(cheques, total, page) {
  const el = document.getElementById('issued-table');
  if (!cheques.length) {
    el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No issued cheques match. Try clearing filters, or issue a new cheque.</td></tr></tbody></table>`;
    return;
  }
  el.innerHTML = `
    <table class="ledger ledger-compact ledger-centered">
      <thead><tr>${sortableHeaderRow()}</tr></thead>
      <tbody>
        ${cheques.map((c) => {
          const ageDays = c.totalDays;
          const isTransfer = !!c.transferToAccountId;
          return `
          <tr data-id="${c.id}">
            <td class="num">${escapeHtml(c.chqNo)}</td>
            <td class="num">${fmtDateStacked(c.chqDate)}</td>
            <td>
              ${isTransfer
                ? `<div>→ ${escapeHtml(c.transferToAccount?.accountName || '—')}<span class="muted cell-sub" style="display:inline"> (transfer)</span></div>`
                // c.payee is the linked vendor record (the source of truth for
                // "who this is") — c.payeeName is just what's literally written
                // on the cheque, so it only gets its own line when it actually
                // differs. Legacy rows from before vendors existed may have no
                // linked payee at all, hence the payeeName fallback for the top line.
                : `<div>${escapeHtml(c.payee?.name || c.payeeName || '—')}</div>
                   ${c.payee && c.payeeName && c.payeeName !== c.payee.name ? `<div class="muted cell-sub">${escapeHtml(c.payeeName)}</div>` : ''}`}
              <div class="muted cell-sub">${escapeHtml(c.pvNo || '—')}</div>
            </td>
            <td>${escapeHtml(c.purpose || '—')}</td>
            <td>
              <div>${escapeHtml(c.companyBankAccount?.bank?.name || '—')}</div>
              <div class="muted cell-sub">${escapeHtml(c.companyBankAccount?.accountName || '—')} · ${escapeHtml(c.companyBankAccount?.accountNumber || '—')}</div>
            </td>
            <td class="amount">${fmtMoney(c.amount)}</td>
            <td>${statusTag(c.status)}</td>
            <td class="num">${fmtDateStacked(c.statusDate)}</td>
            <td>${ageTag(ageDays)}</td>
            <td>${escapeHtml(c.authority?.name || '—')}</td>
            <td><button type="button" class="btn btn-sm btn-ghost act-view" data-id="${c.id}">View</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${paginationControls(total, page, PAGE_SIZE)}`;
  el.querySelectorAll('th[data-sort-field]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sortField;
      const existing = issuedSort.find((s) => s.field === field);
      let message;
      if (!existing) {
        issuedSort.push({ field, dir: 'asc' });
        message = 'ascending';
      } else if (existing.dir === 'asc') {
        existing.dir = 'desc';
        message = 'descending';
      } else {
        issuedSort = issuedSort.filter((s) => s.field !== field);
        message = null;
      }
      const col = ISSUED_COLUMNS.find((c) => c.field === field);
      if (message) {
        const level = issuedSort.find((s) => s.field === field);
        const levelNum = issuedSort.length > 1 ? ` (level ${issuedSort.indexOf(level) + 1})` : '';
        toast(`Sorting by ${col.label} — ${message}${levelNum}`);
      } else {
        toast(`Stopped sorting by ${col.label}`);
      }
      loadIssued(1);
    });
  });
  el.querySelectorAll('tr[data-id]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.act-view')) return;
      openIssuedDetail(row.dataset.id);
    });
  });
  el.querySelectorAll('.act-view').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openIssuedDetail(btn.dataset.id);
    });
  });
  wirePaginationControls(el, total, page, loadIssued, PAGE_SIZE);
}

document.getElementById('issued-search').addEventListener('input', debounce(() => loadIssued(1), 300));
document.getElementById('issued-status-filter').addEventListener('change', () => loadIssued(1));
document.getElementById('issued-fy-filter').addEventListener('change', () => loadIssued(1));
document.getElementById('issued-date-from').addEventListener('change', () => loadIssued(1));
document.getElementById('issued-date-to').addEventListener('change', () => loadIssued(1));
document.getElementById('issued-amount-min').addEventListener('input', debounce(() => loadIssued(1), 300));
document.getElementById('issued-amount-max').addEventListener('input', debounce(() => loadIssued(1), 300));
document.getElementById('issued-transfers-filter').addEventListener('change', () => loadIssued(1));

document.getElementById('btn-issued-clear-filters').addEventListener('click', () => {
  document.getElementById('issued-search').value = '';
  document.getElementById('issued-status-filter').value = '';
  document.getElementById('issued-fy-filter').value = '';
  document.getElementById('issued-amount-min').value = '';
  document.getElementById('issued-amount-max').value = '';
  document.getElementById('issued-transfers-filter').value = '';
  const dateFrom = document.getElementById('issued-date-from');
  const dateTo = document.getElementById('issued-date-to');
  dateFrom.value = '';
  dateTo.value = '';
  syncBsDatePicker(dateFrom);
  syncBsDatePicker(dateTo);
  issuedSort = DEFAULT_ISSUED_SORT.map((s) => ({ ...s }));
  toast('Filters and sorting cleared');
  loadIssued(1);
});

document.getElementById('btn-new-issued').addEventListener('click', () => renderIssuedFormModal('new', null));

// Field markup for the "new" record — no <form> wrapper or buttons; those
// come from renderIssuedFormModal.
function newIssuedFieldsHtml() {
  return `
    <div class="field">
      <label>Our bank account *</label>
      <select name="companyBankAccountId" required>${selectOptions(state.accounts, 'id', (a) => `${a.accountName} — ${a.bank?.name || ''}`, 'Select account…')}</select>
    </div>
    <div class="field">
      <label>Fiscal year *</label>
      <select name="fiscalYearId" required>${selectOptions(state.fiscalYears, 'id', (f) => f.year, 'Select fiscal year…')}</select>
    </div>
    <div class="field">
      <label>Cheque no *</label>
      <input name="chqNo" type="text" required>
    </div>
    <div class="field">
      <label>Cheque date *</label>
      <input name="chqDate" type="date" data-bs-mode="text" required>
    </div>
    <div class="field">
      <label>PV no.</label>
      <input name="pvNo" type="text" placeholder="PV-1024">
    </div>
    <div class="field">
      <label>Amount *</label>
      <input name="amount" type="number" step="0.01" min="0.01" required>
    </div>
    <div class="field span-2">
      <label class="checkbox-field">
        <input type="checkbox" id="is-transfer-toggle">
        This is a transfer to another of our own accounts (not a payment to a payee)
      </label>
    </div>
    <div id="payee-fields" class="field span-2" style="display:contents">
      <div class="field span-2">
        <label>Vendor *</label>
        <select name="payeeId">${selectOptions(state.parties.filter((p) => p.isVendor), 'id', (p) => p.name, 'Select vendor…')}</select>
      </div>
      <div class="field">
        <label>Payee name on cheque <span class="hint" style="font-weight:normal">(if different from vendor)</span></label>
        <input name="payeeName" type="text">
      </div>
      <div class="field">
        <label>Payee type *</label>
        <select name="payeeType">${enumOptions(PARTY_TYPES)}</select>
      </div>
      <div class="field">
        <label>Payee category</label>
        <select name="payeeCategory">${enumOptions(PAYEE_CATEGORIES, 'Not specified')}</select>
      </div>
    </div>
    <div id="transfer-fields" class="field span-2" style="display:none">
      <label>Transfer to account *</label>
      <select name="transferToAccountId">${selectOptions(state.accounts, 'id', (a) => `${a.accountName} — ${a.bank?.name || ''}`, 'Select destination account…')}</select>
    </div>
    <div class="field">
      <label>Issued by staff</label>
      <select name="issuedById">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
    </div>
    <div class="field">
      <label>Authority</label>
      <select name="authorityId">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
    </div>
    <div class="field span-2">
      <label>Purpose</label>
      <textarea name="purpose" placeholder="e.g. against bill no. 4521"></textarea>
    </div>`;
}

// Wires the transfer/payee toggle for the "new" form. Returns a function
// that strips whichever side (payee vs transfer) is inactive from the
// submitted FormData — mirrors the old openNewIssuedModal submit logic.
function wireIssuedTransferToggle(form) {
  const toggle = document.getElementById('is-transfer-toggle');
  const payeeFields = document.getElementById('payee-fields');
  const transferFields = document.getElementById('transfer-fields');
  const payeeIdSelect = form.querySelector('[name="payeeId"]');
  const payeeTypeSelect = form.querySelector('[name="payeeType"]');
  const transferToSelect = form.querySelector('[name="transferToAccountId"]');

  const applyToggle = () => {
    const isTransfer = toggle.checked;
    payeeFields.style.display = isTransfer ? 'none' : 'contents';
    transferFields.style.display = isTransfer ? '' : 'none';
    payeeIdSelect.required = !isTransfer;
    payeeTypeSelect.required = !isTransfer;
    transferToSelect.required = isTransfer;
  };
  toggle.addEventListener('change', applyToggle);
  applyToggle();

  return (data) => {
    delete data.__ignore;
    if (toggle.checked) {
      delete data.payeeId;
      delete data.payeeName;
      delete data.payeeType;
      delete data.payeeCategory;
    } else {
      delete data.transferToAccountId;
      if (!data.payeeName) delete data.payeeName;
      if (!data.payeeCategory) delete data.payeeCategory;
    }
    return data;
  };
}

async function openIssuedDetail(id) {
  try {
    const c = await api(`/issued-cheques/${id}`);
    renderIssuedDrawer(c);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Log of "what happened when" for the drawer's Status history section.
// No presentedAt anymore — PRESENTED was dropped as a status entirely
// (see the schema migration), we only ever learn the final outcome.
function renderIssuedStatusHistory(c) {
  const stages = [
    { label: 'Issued', date: c.createdAt },
    { label: 'Cleared', date: c.clearedAt },
    { label: 'Returned', date: c.bouncedAt },
    { label: 'Cancelled', date: c.cancelledAt },
  ].filter((s) => s.date).sort((a, b) => new Date(a.date) - new Date(b.date));

  // ON_CHECK doesn't stamp a dedicated stage column, so show the current
  // status/statusDate explicitly in that case (same reasoning as the
  // received-cheque version).
  const currentIsUnstamped = !['CLEARED', 'RETURNED', 'STOPPED'].includes(c.status);

  if (!stages.length && !currentIsUnstamped) {
    return `<p class="timeline-empty">No status changes recorded yet.</p>`;
  }

  return stages.map((s) => `
    <div class="timeline-item">
      <div class="ti-head"><span>${s.label}</span><span class="ti-meta">${fmtDate(s.date)}</span></div>
    </div>`).join('') + (currentIsUnstamped ? `
    <div class="timeline-item">
      <div class="ti-head"><span>${humanize(c.status)}</span><span class="ti-meta">${fmtDate(c.statusDate)}</span></div>
      ${c.previousStatus ? `<div class="ti-meta">Previously: ${humanize(c.previousStatus)}</div>` : ''}
    </div>` : '');
}

function renderIssuedDrawer(c) {
  const isTransfer = !!c.transferToAccountId;
  const canFollowUp = c.status === 'RETURNED';
  const canPay = !isTransfer && !['CLEARED'].includes(c.status);
  const canCheckLog = c.status !== 'ON_CHECK';
  const canReplace = c.status === 'RETURNED' && !c.replacedBy;
  const canStop = c.status === 'ISSUED';
  const openCheckLog = c.checkLogs.find((l) => !l.resolvedAt);

  const html = `
    <div class="drawer-header">
      <div>
        <h2>Issued cheque ${escapeHtml(c.chqNo)}</h2>
        <p class="hint" style="margin-top:0.2rem">${isTransfer ? `Transfer → ${escapeHtml(c.transferToAccount?.accountName || '—')}` : escapeHtml(c.payee?.name || c.payeeName || '—')} · ${fmtDate(c.chqDate)}</p>
      </div>
      <button class="drawer-close" id="drawer-close-btn" aria-label="Close">×</button>
    </div>

    <div>${statusTag(c.status)} <span class="muted num" style="font-size:0.8rem">since ${fmtDate(c.statusDate)}${c.totalDays != null ? ` · ${c.totalDays}d` : ''}</span></div>

    <dl class="detail-grid">
      <div class="detail-field"><dt>Amount</dt><dd>Rs ${fmtMoney(c.amount)}</dd></div>
      <div class="detail-field"><dt>Fiscal year</dt><dd>${escapeHtml(c.fiscalYear?.year || '—')}</dd></div>
      ${c.pvNo ? `<div class="detail-field"><dt>PV no.</dt><dd class="num">${escapeHtml(c.pvNo)}</dd></div>` : ''}
      <div class="detail-field"><dt>Our account</dt><dd>${escapeHtml(c.companyBankAccount?.accountName || '—')}</dd></div>
      <div class="detail-field"><dt>Bank</dt><dd>${escapeHtml(c.companyBankAccount?.bank?.name || '—')}</dd></div>
      ${isTransfer
        ? `<div class="detail-field"><dt>Transfer to</dt><dd>${escapeHtml(c.transferToAccount?.accountName || '—')} (${escapeHtml(c.transferToAccount?.bank?.name || '—')})</dd></div>`
        : `
      <div class="detail-field"><dt>Vendor</dt><dd>${escapeHtml(c.payee?.name || '—')}</dd></div>
      ${c.payee && c.payeeName && c.payeeName !== c.payee.name ? `<div class="detail-field"><dt>Payee name on cheque</dt><dd>${escapeHtml(c.payeeName)}</dd></div>` : ''}
      <div class="detail-field"><dt>Payee type</dt><dd>${humanize(c.payeeType)}</dd></div>
      ${c.payeeCategory ? `<div class="detail-field"><dt>Payee category</dt><dd>${humanize(c.payeeCategory)}</dd></div>` : ''}
      ${c.payeeType === 'INDIVIDUAL' && c.payee?.firm ? `<div class="detail-field"><dt>Supplier</dt><dd>${escapeHtml(c.payee.firm.name)}</dd></div>` : ''}`}
      <div class="detail-field"><dt>Cheque type</dt><dd>${humanize(c.chequeType)}</dd></div>
      <div class="detail-field"><dt>Issued by</dt><dd>${escapeHtml(c.issuedBy?.name || '—')}</dd></div>
      <div class="detail-field"><dt>Authority</dt><dd>${escapeHtml(c.authority?.name || '—')}</dd></div>
      ${c.purpose ? `<div class="detail-field"><dt>Purpose</dt><dd>${escapeHtml(c.purpose)}</dd></div>` : ''}
      ${c.clearanceMethod ? `<div class="detail-field"><dt>Cleared via</dt><dd>${humanize(c.clearanceMethod)}</dd></div>` : ''}
      ${c.returnReason ? `<div class="detail-field"><dt>Return reason</dt><dd>${humanize(c.returnReason)}</dd></div>` : ''}
      ${c.replaces ? `<div class="detail-field"><dt>Replaces</dt><dd class="num">${escapeHtml(c.replaces.chqNo)}</dd></div>` : ''}
      ${c.replacedBy ? `<div class="detail-field"><dt>Replaced by</dt><dd class="num">${escapeHtml(c.replacedBy.chqNo)}</dd></div>` : ''}
    </dl>

    <div class="section-title">Status history</div>
    <div class="timeline">
      ${renderIssuedStatusHistory(c)}
    </div>

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
      // Same pattern as received.js — both entry points open the one
      // navigable form; Delete opens it read-only, Delete button one click away.
      if (action === 'edit') { closeDrawer(); renderIssuedFormModal('edit', c); }
      if (action === 'delete') { closeDrawer(); renderIssuedFormModal('view', c); }
    });
  });
}

// Field markup for editing an existing record's freely-editable fields.
// `isTransfer` cheques never had a payee, so payeeCategory doesn't apply.
function editIssuedFieldsMain(c, isTransfer) {
  return `
    <div class="field">
      <label>Fiscal year *</label>
      <select name="fiscalYearId" required>${selectOptions(state.fiscalYears, 'id', (f) => f.year, 'Select fiscal year…')}</select>
    </div>
    <div class="field">
      <label>PV no.</label>
      <input name="pvNo" type="text" value="${escapeHtml(c.pvNo || '')}">
    </div>
    <div class="field">
      <label>Amount *</label>
      <input name="amount" type="number" step="0.01" min="0.01" required value="${escapeHtml(c.amount)}">
    </div>
    <div class="field">
      <label>Issued by staff</label>
      <select name="issuedById">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
    </div>
    <div class="field">
      <label>Authority</label>
      <select name="authorityId">${selectOptions(state.staff, 'id', (s) => s.name, 'Unassigned')}</select>
    </div>
    ${!isTransfer ? `
    <div class="field">
      <label>Payee category</label>
      <select name="payeeCategory">${enumOptions(PAYEE_CATEGORIES, 'Not specified')}</select>
    </div>` : ''}
    <div class="field span-2">
      <label>Purpose</label>
      <textarea name="purpose">${escapeHtml(c.purpose || '')}</textarea>
    </div>`;
}

// "Risky" fields — feed the account/cheque-no uniqueness check and the
// day-count math (see editChequeFieldsRisky in received.js for the pattern).
function editIssuedFieldsRisky(c, isTransfer) {
  return `
    <div class="field">
      <label>Cheque date *</label>
      <input name="chqDate" type="date" data-bs-mode="text" required value="${fmtDateInput(c.chqDate)}">
    </div>
    <div class="field">
      <label>Cheque no *</label>
      <input name="chqNo" type="text" required value="${escapeHtml(c.chqNo)}">
    </div>
    <div class="field span-2">
      <label>Our account *</label>
      <select name="companyBankAccountId" required>${selectOptions(state.accounts, 'id', (a) => `${a.accountName} — ${a.bank?.name || ''}`, 'Select account…')}</select>
    </div>
    ${!isTransfer ? `
    <div class="field">
      <label>Payee type *</label>
      <select name="payeeType" required>${enumOptions(PARTY_TYPES)}</select>
    </div>` : `<p class="hint">Payee type doesn't apply — this cheque is a transfer to ${escapeHtml(c.transferToAccount?.accountName || 'another of our accounts')}, which isn't editable after creation.</p>`}`;
}

// Read-only summary for 'view' mode.
function issuedViewInfoHtml(c) {
  const isTransfer = !!c.transferToAccountId;
  return `
    <dl class="detail-grid" style="margin-top:0.2rem">
      <div class="detail-field"><dt>Amount</dt><dd>Rs ${fmtMoney(c.amount)}</dd></div>
      <div class="detail-field"><dt>Fiscal year</dt><dd>${escapeHtml(c.fiscalYear?.year || '—')}</dd></div>
      <div class="detail-field"><dt>PV no.</dt><dd>${escapeHtml(c.pvNo || '—')}</dd></div>
      <div class="detail-field"><dt>Our account</dt><dd>${escapeHtml(c.companyBankAccount?.accountName || '—')}</dd></div>
      <div class="detail-field"><dt>Bank</dt><dd>${escapeHtml(c.companyBankAccount?.bank?.name || '—')}</dd></div>
      <div class="detail-field"><dt>Cheque date</dt><dd>${fmtDate(c.chqDate)}</dd></div>
      <div class="detail-field"><dt>Cheque no</dt><dd class="num">${escapeHtml(c.chqNo)}</dd></div>
      ${isTransfer
        ? `<div class="detail-field"><dt>Transfer to</dt><dd>${escapeHtml(c.transferToAccount?.accountName || '—')} (${escapeHtml(c.transferToAccount?.bank?.name || '—')})</dd></div>`
        : `
      <div class="detail-field"><dt>Vendor</dt><dd>${escapeHtml(c.payee?.name || '—')}</dd></div>
      <div class="detail-field"><dt>Payee name on cheque</dt><dd>${escapeHtml(c.payeeName || '—')}</dd></div>
      <div class="detail-field"><dt>Payee type</dt><dd>${humanize(c.payeeType)}</dd></div>
      <div class="detail-field"><dt>Payee category</dt><dd>${c.payeeCategory ? humanize(c.payeeCategory) : '—'}</dd></div>`}
      <div class="detail-field"><dt>Issued by</dt><dd>${escapeHtml(c.issuedBy?.name || '—')}</dd></div>
      <div class="detail-field"><dt>Authority</dt><dd>${escapeHtml(c.authority?.name || '—')}</dd></div>
      <div class="detail-field"><dt>Purpose</dt><dd>${escapeHtml(c.purpose || '—')}</dd></div>
    </dl>`;
}

// ----------------------------------------------------------------------------
// Unified New / View / Edit form modal for issued cheques — mirrors
// renderReceivedFormModal in received.js; see the comments there.
// ----------------------------------------------------------------------------
function renderIssuedFormModal(mode, cheque) {
  const isNew = mode === 'new';
  const isEdit = mode === 'edit';
  const isTransfer = !isNew && !!cheque.transferToAccountId;
  const title = isNew ? 'New issued cheque' : `Issued cheque ${escapeHtml(cheque.chqNo)}`;
  const position = isNew ? null : issuedIndexOf(cheque.id);

  let bodyInner;
  if (isNew) {
    bodyInner = `
      <form id="form-issued-record">
        <div class="form-error"></div>
        <div class="form-grid">${newIssuedFieldsHtml()}</div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save cheque</button>
        </div>
      </form>`;
  } else if (isEdit) {
    bodyInner = `
      <form id="form-issued-record">
        <div class="form-error"></div>
        <div class="form-grid">${editIssuedFieldsMain(cheque, isTransfer)}</div>
        <div class="section-title" style="margin-top:1rem">Risky fields</div>
        <p class="hint" style="margin-top:0">These affect the account/cheque-no uniqueness check and the lifecycle day-count. You'll be asked to confirm if you change any of them.</p>
        <div class="form-grid">${editIssuedFieldsRisky(cheque, isTransfer)}</div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save changes</button>
        </div>
      </form>`;
  } else {
    bodyInner = issuedViewInfoHtml(cheque);
  }

  openModal(title, `${toolbarHtml()}${bodyInner}`, {
    onMount: () => {
      const root = document.getElementById('modal-content');
      setToolbarState(root, { mode, position, total: issuedNavTotal });
      wireToolbar(root, {
        new: () => { closeModal(); renderIssuedFormModal('new', null); },
        edit: () => { if (mode === 'view') { closeModal(); renderIssuedFormModal('edit', cheque); } },
        delete: () => { if (!isNew) issuedDeleteFromForm(cheque); },
        prev: () => issuedNavigate(mode, position, -1),
        next: () => issuedNavigate(mode, position, 1),
        copy: () => issuedCopyRecord(mode, cheque),
        paste: () => issuedPasteRecord(),
      });

      const form = document.getElementById('form-issued-record');
      let stripInactiveSide = (data) => data; // no-op unless 'new' wires the transfer toggle

      if (isNew) {
        stripInactiveSide = wireIssuedTransferToggle(form);
      } else if (isEdit) {
        form.querySelector('[name="fiscalYearId"]').value = cheque.fiscalYearId;
        syncEditableSelect(form.querySelector('[name="fiscalYearId"]'));
        form.querySelector('[name="issuedById"]').value = cheque.issuedById || '';
        syncEditableSelect(form.querySelector('[name="issuedById"]'));
        form.querySelector('[name="authorityId"]').value = cheque.authorityId || '';
        syncEditableSelect(form.querySelector('[name="authorityId"]'));
        form.querySelector('[name="companyBankAccountId"]').value = cheque.companyBankAccountId;
        syncEditableSelect(form.querySelector('[name="companyBankAccountId"]'));
        if (!isTransfer) {
          form.querySelector('[name="payeeCategory"]').value = cheque.payeeCategory || '';
          form.querySelector('[name="payeeType"]').value = cheque.payeeType;
        }
      }

      if (form) form.addEventListener('submit', (e) => issuedSubmitForm(e, isEdit, cheque, isTransfer, stripInactiveSide));
    },
  });
}

async function issuedDeleteFromForm(c) {
  const ok = await openConfirmModal(
    'Delete issued cheque?',
    `This removes cheque ${escapeHtml(c.chqNo)} from active lists and can be restored from Trash. Its history is kept, not erased.`,
  );
  if (!ok) return;
  try {
    await api(`/issued-cheques/${c.id}`, { method: 'DELETE' });
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  toast('Issued cheque deleted', 'success');
  issuedNavParams = null;
  issuedNavPages = new Map();
  issuedNavTotal = 0;
  closeModal();
  loadIssued();
  loadDashboard();
}

async function issuedNavigate(mode, position, delta) {
  if (mode === 'new' || position == null || position < 0) return;
  const targetIndex = position + delta;
  const id = await issuedIdAtIndex(targetIndex);
  if (!id) {
    toast(delta < 0 ? 'Already at the first record' : 'Already at the last record');
    return;
  }
  try {
    const c = await api(`/issued-cheques/${id}`);
    closeModal();
    renderIssuedFormModal(mode === 'edit' ? 'edit' : 'view', c);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function issuedCopyRecord(mode, cheque) {
  const form = document.getElementById('form-issued-record');
  const data = form
    ? Object.fromEntries(new FormData(form).entries())
    : {
        companyBankAccountId: cheque.companyBankAccountId, fiscalYearId: cheque.fiscalYearId,
        chqNo: cheque.chqNo, chqDate: fmtDateInput(cheque.chqDate), pvNo: cheque.pvNo, amount: cheque.amount,
        payeeId: cheque.payeeId, payeeName: cheque.payeeName, payeeType: cheque.payeeType,
        payeeCategory: cheque.payeeCategory, transferToAccountId: cheque.transferToAccountId,
        issuedById: cheque.issuedById, authorityId: cheque.authorityId, purpose: cheque.purpose,
      };
  const ok = await copyRecordToClipboard('issuedCheque', data);
  toast(ok ? 'Cheque details copied' : 'Could not access the clipboard — check browser permissions', ok ? 'success' : 'error');
}

async function issuedPasteRecord() {
  const form = document.getElementById('form-issued-record');
  if (!form) return;
  const data = await readRecordFromClipboard('issuedCheque');
  if (!data) {
    toast('Clipboard doesn\'t contain a copied issued cheque', 'error');
    return;
  }
  // If the copied record's transfer/payee shape differs from the form's
  // current toggle state, flip the toggle first so the right fields are
  // visible/required before we fill them in.
  const toggle = document.getElementById('is-transfer-toggle');
  if (toggle) {
    const shouldBeTransfer = !!data.transferToAccountId;
    if (toggle.checked !== shouldBeTransfer) {
      toggle.checked = shouldBeTransfer;
      toggle.dispatchEvent(new Event('change'));
    }
  }
  Object.entries(data).forEach(([key, value]) => {
    if (value == null) return;
    const field = form.querySelector(`[name="${key}"]`);
    if (!field) return;
    field.value = value;
    if (field.tagName === 'SELECT') syncEditableSelect(field);
    if (field.type === 'date') syncBsDatePicker(field);
  });
  toast('Cheque details pasted — review before saving', 'success');
}

async function issuedSubmitForm(e, isEdit, cheque, isTransfer, stripInactiveSide) {
  e.preventDefault();
  const form = e.target;
  clearFormError(form);
  let data = Object.fromEntries(new FormData(form).entries());
  data = stripInactiveSide(data);
  if (isEdit && !data.payeeCategory) delete data.payeeCategory;

  if (isEdit) {
    const riskyChanged = data.chqDate !== fmtDateInput(cheque.chqDate)
      || data.chqNo !== cheque.chqNo
      || data.companyBankAccountId !== cheque.companyBankAccountId
      || (!isTransfer && data.payeeType !== cheque.payeeType);
    if (riskyChanged) {
      const ok = await openConfirmModal(
        'Change risky fields?',
        'You\'re changing the cheque date, cheque no, our account, or payee type. These affect the uniqueness check and the lifecycle day-count for this cheque. Continue?',
        { confirmLabel: 'Save changes', danger: false },
      );
      if (!ok) return;
    }
    try {
      const updated = await api(`/issued-cheques/${cheque.id}`, { method: 'PATCH', body: JSON.stringify(data) });
      toast('Issued cheque updated', 'success');
      closeModal();
      renderIssuedFormModal('view', updated);
      loadIssued();
      loadDashboard();
    } catch (err) {
      formError(form, err.message);
    }
  } else {
    try {
      const created = await api('/issued-cheques', { method: 'POST', body: JSON.stringify(data) });
      toast('Issued cheque recorded', 'success');
      closeModal();
      renderIssuedFormModal('view', created);
      loadIssued();
      loadDashboard();
    } catch (err) {
      formError(form, err.message);
    }
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
        <div class="field span-2">
          <label>Status date *</label>
          <input name="statusDate" type="date" data-bs-mode="text" id="status-date-input" required value="${fmtDateInput(c.statusDate)}" min="${fmtDateInput(c.chqDate)}">
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
          <input name="followUpDate" type="date" data-bs-mode="text" value="${fmtDateInput(new Date())}">
        </div>
        <div class="field">
          <label>Next action date</label>
          <input name="nextActionDate" type="date" data-bs-mode="text">
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
          <input name="paymentDate" type="date" data-bs-mode="text" value="${fmtDateInput(new Date())}">
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
          <input name="chqDate" type="date" data-bs-mode="text" required>
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