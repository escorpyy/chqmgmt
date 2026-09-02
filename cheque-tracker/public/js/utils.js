// ============================================================================
// Small utilities
// ============================================================================
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

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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

export function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
