import { api } from './api.js';
import { toast } from './toast.js';
import { fmtMoney, fmtDate, escapeHtml, statusTag } from './utils.js';
import { RECEIVED_STATUSES, ISSUED_STATUSES } from './constants.js';
import { openChequeDetail } from './received.js';

// ============================================================================
// Dashboard
// ============================================================================
export async function loadDashboard() {
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
