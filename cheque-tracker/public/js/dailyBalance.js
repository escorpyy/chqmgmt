import { api } from './api.js';
import { toast } from './toast.js';
import { escapeHtml, fmtMoney } from './utils.js';
import { syncBsDatePicker } from './bsDatePicker.js';
import { initAutocomplete } from './autocomplete.js';
import { API } from './constants.js';

// ============================================================================
// DAILY BANK BALANCE
// ============================================================================
function dbSelectedDate() {
  const picker = document.getElementById('db-date-picker');
  if (!picker.value) {
    picker.value = new Date().toISOString().slice(0, 10);
    // Setting .value directly doesn't fire 'change', so nudge the BS picker
    // (wired in main.js on boot) to pick up today's default.
    syncBsDatePicker(picker);
  }
  return picker.value;
}

export async function loadDailyBalance() {
  const date = dbSelectedDate();
  const el = document.getElementById('daily-balance-table');
  try {
    const { rows, totals } = await api(`/daily-balance?date=${date}`);
    renderDailyBalanceTable(rows, totals);
  } catch (err) {
    el.innerHTML = '';
    toast(err.message, 'error');
  }
}

function renderDailyBalanceTable(rows, totals) {
  const el = document.getElementById('daily-balance-table');
  if (!rows.length) {
    el.innerHTML = `<table class="ledger"><tbody><tr class="empty-row"><td>No bank accounts yet. Add one under "Our accounts" first.</td></tr></tbody></table>`;
    return;
  }

  const availableCell = (r) => {
    if (r.available === null) return `<td class="num">—</td>`;
    const cls = r.available < 0 ? ' class="num db-negative"' : ' class="num"';
    return `<td${cls}>${fmtMoney(r.available)}</td>`;
  };

  el.innerHTML = `
    <table class="ledger">
      <thead>
        <tr>
          <th>Bank Account</th>
          <th>Opening Balance</th>
          <th>Cheques Due</th>
          <th>Received Today</th>
          <th>Available Balance</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr data-id="${r.companyBankAccountId}">
            <td>${escapeHtml(r.accountName)}<br><span class="hint" style="margin:0">${escapeHtml(r.bankName)}</span></td>
            <td class="num">
              <input type="number" step="0.01" class="db-input" data-field="openingBalance"
                     value="${r.openingBalanceSet ? r.openingBalance : ''}" placeholder="Not set yet">
            </td>
            <td class="num">${fmtMoney(r.chequesDue)}</td>
            <td class="num">
              <input type="number" step="0.01" class="db-input" data-field="receivedToday"
                     value="${r.receivedToday}">
            </td>
            ${availableCell(r)}
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr class="db-total-row">
          <td>Total</td>
          <td class="num">${fmtMoney(totals.openingBalance)}</td>
          <td class="num">${fmtMoney(totals.chequesDue)}</td>
          <td class="num">${fmtMoney(totals.receivedToday)}</td>
          <td class="num">${totals.allSet ? fmtMoney(totals.available) : '—'}</td>
        </tr>
      </tfoot>
    </table>
    ${totals.allSet ? '' : '<p class="hint">Some accounts are missing today\'s opening balance — their available figure and the total won\'t be accurate until it\'s entered.</p>'}
  `;

  initAutocomplete(el); // these balance inputs render outside any modal/drawer, so they need their own call

  el.querySelectorAll('.db-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const row = input.closest('tr');
      const companyBankAccountId = row.dataset.id;
      const field = input.dataset.field;
      const value = input.value === '' ? 0 : Number(input.value);
      try {
        await api(`/daily-balance/${companyBankAccountId}`, {
          method: 'PUT',
          body: JSON.stringify({ date: dbSelectedDate(), [field]: value }),
        });
        loadDailyBalance();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

document.getElementById('db-date-picker').addEventListener('change', loadDailyBalance);
document.getElementById('btn-db-export').addEventListener('click', () => {
  window.open(`${API}/daily-balance/export?date=${dbSelectedDate()}`, '_blank');
});
