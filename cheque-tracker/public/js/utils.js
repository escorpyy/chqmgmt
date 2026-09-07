// ============================================================================
// Small utilities
// ============================================================================
import { formatBsLong, formatBsSlash } from './nepaliDate.js';

export function humanize(value) {
  if (!value) return '—';
  return value.toString().toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return str.toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function fmtMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// This is a Nepal-based app: BS (Bikram Sambat) is the date system staff
// think in day to day, so it leads. AD stays visible in brackets purely as
// a cross-reference (e.g. for bank statements, which are AD-dated) — but
// every internal calculation (sorting, "days outstanding", storage) still
// runs on the underlying AD value; only the display is BS-first.
export function fmtDate(value) {
  if (!value) return '—';
  const bs = formatBsLong(value);
  const d = new Date(value);
  const ad = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return bs ? `${bs} BS (${ad})` : ad;
}

// AD-only date, for places where the BS prefix would be too noisy (e.g. dense tables).
export function fmtDateAdOnly(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// BS-only date string, e.g. for compact chips where the AD form isn't needed.
export function fmtBsDate(value) {
  if (!value) return '—';
  const bs = formatBsLong(value);
  return bs ? `${bs} BS` : '—';
}

// AD date as dd/mm/yyyy — pairs with formatBsSlash for the stacked cell below.
export function fmtDateAdSlash(value) {
  if (!value) return '—';
  const d = new Date(value);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Two-line date cell for dense tables: BS dd/mm/yyyy on top, AD dd/mm/yyyy
// below it. Returns HTML — use inside a <td>.
export function fmtDateStacked(value) {
  if (!value) return '—';
  const bs = formatBsSlash(value);
  const ad = fmtDateAdSlash(value);
  return `<div class="date-stack"><span class="date-bs">${bs || '—'}</span><span class="date-ad muted">${ad}</span></div>`;
}

export function fmtDateInput(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

export function statusTag(status) {
  return `<span class="status-tag status-${status}">${humanize(status)}</span>`;
}

export function selectOptions(items, valueKey, labelFn, placeholder) {
  const opts = [`<option value="">${placeholder || 'Select…'}</option>`];
  for (const item of items) {
    opts.push(`<option value="${escapeHtml(item[valueKey])}">${escapeHtml(labelFn(item))}</option>`);
  }
  return opts.join('');
}

export function enumOptions(values, placeholder) {
  const opts = placeholder ? [`<option value="">${placeholder}</option>`] : [];
  for (const v of values) opts.push(`<option value="${v}">${humanize(v)}</option>`);
  return opts.join('');
}

// Whole days between a stored date and now. Used for "age" / "days
// outstanding" columns — client-side only, purely for display, so it
// always reflects "as of right now" even for a status that's been sitting
// unchanged since the page loaded.
export function daysSince(value) {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// Renders an age in days, flagging it as stale past the threshold so a
// register can be scanned for what's been sitting too long without opening
// every row.
export function ageTag(days, staleAfter = 30) {
  if (days === null || days === undefined) return '<span class="muted">—</span>';
  const cls = days > staleAfter ? 'age-stale' : '';
  return `<span class="num ${cls}">${days}d</span>`;
}

export function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
