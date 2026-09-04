// ============================================================================
// Editable dropdowns (type-to-filter comboboxes)
//
// Applies to every <select> in the app whose options come from one of the
// app's own master tables (Parties, Banks, Our accounts, Staff, Fiscal years —
// already loaded into state.js), keyed by the select's `name` attribute.
// A plain enum <select> (status, payment method, party type…) has no master
// table behind it — nothing to search against, nothing to create against —
// so those are left as ordinary <select>s.
//
// Pattern mirrors bsDatePicker.js: the original <select> stays in the DOM
// (still carries the real `name` attribute the app's forms read via
// `new FormData(form)`, and still participates in HTML5 "required"
// constraint validation) but is visually hidden; a text input + dropdown
// list on top are the real interactive control. Picking an option — or
// creating a brand new master record — sets `select.value` and fires a real
// 'change' event on it, so the rest of the app reacts exactly as if the
// value had been chosen from a native <select>.
//
// If nothing typed matches an existing record, the last item in the list is
// "+ Create '<what you typed>'…" — picking it opens that field's referred
// master table's own creation form (as a modal). Because modal.js supports
// nested modals, the form the combobox lives on (e.g. "New issued cheque")
// isn't lost while that happens: it's stashed, not re-rendered, and comes
// back exactly as the user left it once the new record is saved, with the
// combobox now pointed at the record that was just created.
//
// Safe to call initEditableSelects() repeatedly on the same subtree (e.g.
// every time a modal or drawer opens) — already-wired selects are skipped,
// same pattern as initBsDatePickers() and initAutocomplete().
// ============================================================================

import { state } from './state.js';
import { escapeHtml } from './utils.js';

const MAX_MATCHES = 30;

// ----------------------------------------------------------------------------
// Master-table sources, keyed by <select name="…">
// ----------------------------------------------------------------------------
const MASTER_FIELDS = {
  bankId: { items: () => state.banks, label: (b) => b.name },
  presentedBankId: { items: () => state.banks, label: (b) => b.name },
  companyBankAccountId: { items: () => state.accounts, label: (a) => `${a.accountName} — ${a.bank?.name || ''}` },
  payeeId: { items: () => state.parties, label: (p) => p.name },
  issuerId: { items: () => state.parties, label: (p) => p.name },
  firmId: { items: () => state.parties.filter((p) => p.type === 'FIRM'), label: (p) => p.name },
  staffId: { items: () => state.staff, label: (s) => s.name },
  issuedById: { items: () => state.staff, label: (s) => s.name },
  raisedById: { items: () => state.staff, label: (s) => s.name },
  // receiptId is gone: fiscal year is now `fiscalYearId` below, and receipt
  // no. is a plain free-text field on the cheque form, backed by no master
  // table.
  fiscalYearId: { items: () => state.fiscalYears, label: (f) => f.year },
};

// Registered by banks.js / staff.js / parties.js / accounts.js / fiscalYears.js
// once each, at module load — decouples this module from theirs (they each
// import this module to register; this module never imports them back).
const creators = {};

/** field name (a MASTER_FIELDS key) -> (typedText, onCreated) => void */
export function registerMasterCreator(key, fn) {
  creators[key] = fn;
}

function fieldKey(select) {
  return select.name || select.dataset.field || null;
}

function currentOptions(select) {
  return Array.from(select.options).filter((o) => o.value !== '');
}

function wireOne(select) {
  const key = fieldKey(select);
  const source = key && MASTER_FIELDS[key];
  if (!source) return; // no master table backs this select — leave it as a plain <select>
  if (select.disabled) return; // e.g. party edit form's firmId when type === FIRM — leave visible & greyed out as-is
  select.dataset.comboWired = '1';
  select.classList.add('combo-native');
  select.tabIndex = -1; // the text input below is the real interactive control

  const wrap = document.createElement('div');
  wrap.className = 'combo-field';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'combo-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const placeholderOpt = select.querySelector('option[value=""]');
  if (placeholderOpt) input.placeholder = placeholderOpt.textContent;

  const list = document.createElement('ul');
  list.className = 'combo-list';
  list.hidden = true;

  wrap.append(input, list);
  select.insertAdjacentElement('afterend', wrap);

  let activeIndex = -1;
  let matches = []; // [{ type: 'option', id, label } | { type: 'create', text }]

  function labelForValue(value) {
    const opt = currentOptions(select).find((o) => o.value === value);
    return opt ? opt.textContent : '';
  }

  function syncFromSelect() {
    input.value = select.value ? labelForValue(select.value) : '';
  }

  function closeList() {
    list.hidden = true;
    list.innerHTML = '';
    activeIndex = -1;
    matches = [];
  }

  function pickOption(id, label) {
    select.value = id;
    input.value = label;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    closeList();
  }

  function pickCreate(typedText) {
    const creator = creators[key];
    if (!creator) return;
    closeList();
    creator(typedText, (record) => {
      if (!record) return; // creation was cancelled
      const label = source.label(record);
      const opt = new Option(label, record.id);
      select.appendChild(opt);
      pickOption(record.id, label);
      input.focus();
    });
  }

  function render(typed) {
    const lower = typed.trim().toLowerCase();
    const seen = new Set();
    const found = [];
    for (const item of source.items()) {
      const label = (source.label(item) || '').toString();
      if (!label || seen.has(label)) continue;
      if (lower && !label.toLowerCase().includes(lower)) continue;
      seen.add(label);
      found.push({ type: 'option', id: String(item.id), label });
      if (found.length >= MAX_MATCHES) break;
    }
    matches = found;

    const typedTrimmed = typed.trim();
    const exactMatch = lower && found.some((m) => m.label.toLowerCase() === lower);
    if (typedTrimmed && !exactMatch && creators[key]) {
      matches = [...found, { type: 'create', text: typedTrimmed }];
    }

    if (!matches.length) { closeList(); return; }

    list.innerHTML = matches.map((m, i) => m.type === 'create'
      ? `<li class="combo-option combo-create" data-index="${i}">+ Create “${escapeHtml(m.text)}”…</li>`
      : `<li class="combo-option" data-index="${i}">${escapeHtml(m.label)}</li>`).join('');
    list.hidden = false;
    activeIndex = -1;

    list.querySelectorAll('li').forEach((li) => {
      // mousedown (not click) so this fires before the input's blur handler closes the list
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const m = matches[Number(li.dataset.index)];
        if (m.type === 'create') pickCreate(m.text);
        else pickOption(m.id, m.label);
      });
    });
  }

  function setActive(i) {
    activeIndex = i;
    const items = list.querySelectorAll('li');
    items.forEach((li, idx) => li.classList.toggle('active', idx === i));
    items[i]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('blur', () => {
    // Editable dropdown, not a free-text field: only picking from the list
    // (or creating a new record) can change the underlying select, so
    // anything left typed but not chosen reverts to whatever was selected.
    setTimeout(() => { syncFromSelect(); closeList(); }, 0);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      render(input.value);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIndex < 0 || !matches[activeIndex]) return;
      e.preventDefault();
      const m = matches[activeIndex];
      if (m.type === 'create') pickCreate(m.text);
      else pickOption(m.id, m.label);
    } else if (e.key === 'Escape') {
      closeList();
      syncFromSelect();
    }
  });

  // Exposed so callers that set `select.value` programmatically (which
  // doesn't fire 'input'/'focus') can ask the combobox to refresh its
  // visible text — e.g. populating an edit form from the record being
  // edited. Same pattern as bsDatePicker's `_bsSync`.
  select._comboSync = syncFromSelect;
  syncFromSelect();
}

// ----------------------------------------------------------------------------
export function initEditableSelects(root = document) {
  root.querySelectorAll('select').forEach((el) => {
    if (el.dataset.comboWired) return;
    wireOne(el);
  });
}

export function syncEditableSelect(select) {
  select?._comboSync?.();
}
