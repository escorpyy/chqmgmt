// ============================================================================
// Inline autocomplete (type-ahead ghost text)
//
// Applies to every form field in the app, whatever its datatype:
//
//  - Free-text fields whose meaning maps onto one of the app's own master
//    tables (Parties, Banks, Our accounts, Staff — already loaded into
//    state.js) get real inline "ghost text" suggested straight from that
//    master data, live: as you type, a matching existing value is shown
//    greyed-out ahead of the cursor (like a browser address bar).
//    Tab, or → at the end of the field, accepts it; Escape dismisses it.
//    A field with no corresponding master table (a cheque number, a purpose
//    note, an amount…) simply isn't wired — there's nothing authoritative
//    to suggest it from, and this app deliberately doesn't guess based on
//    what was merely typed before.
//
//  - <select>s already get type-ahead for free from the browser itself
//    (focus one and start typing to jump to a matching option), so there's
//    nothing to add there.
//
//  - <input type="date"> is a special case in this app: bsDatePicker.js
//    hides the native control entirely and replaces it with BS
//    year/month/day <select>s, so there's no text box left to overlay ghost
//    text onto, and dates aren't master data the way a party or bank is.
//    Instead, once those selects exist, a small "Use dd/mm/yyyy?"
//    suggestion chip appears with the last date entered for that field —
//    click it (or Enter/Space, since it's a real <button>) to fill the BS
//    selects and the underlying AD value in one go. That one small piece
//    still remembers what you last typed (kept in localStorage), since
//    there's no master list of dates to draw from instead.
//
// Safe to call initAutocomplete() repeatedly on the same subtree (e.g. every
// time a modal or drawer opens) — already-wired fields are skipped, same
// pattern as initBsDatePickers().
// ============================================================================

import { adToBs } from './nepaliDate.js';
import { state } from './state.js';

const STORE_PREFIX = 'chqmgmt.autocomplete.';
const MAX_HISTORY = 25;

// ----------------------------------------------------------------------------
// Master-table suggestion sources, keyed by field name
// ----------------------------------------------------------------------------
const FIELD_SOURCES = {
  // "Payee name on cheque" on both the received and issued forms — the
  // name written on the cheque is almost always one of the app's Parties.
  payeeName: () => state.parties.map((p) => p.name),
  issuedOn: () => state.parties.map((p) => p.name),
  // Shared by banks.js (a bank's own branch) and accounts.js (the branch a
  // company account is held at) — both draw on the same real-world set of
  // branch locations, so pool what's already on file in either table.
  branch: () => [...state.banks.map((b) => b.branch), ...state.accounts.map((a) => a.branch)],
  // fiscalYear is now a combobox <select> (fiscalYearId, see combobox.js)
  // rather than free text, and receiptNo has no master table behind it
  // anymore — nothing left here to suggest either from.
};

function fieldKey(el) {
  return el.name || el.id || el.dataset.field || null;
}

function bestMatch(key, typed) {
  const source = FIELD_SOURCES[key];
  if (!source || !typed) return null;
  const lower = typed.toLowerCase();
  const seen = new Set();
  for (const raw of source()) {
    const entry = (raw || '').toString();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    if (entry.length > typed.length && entry.toLowerCase().startsWith(lower)) return entry;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Ghost-text overlay for text-like inputs and textareas
// ----------------------------------------------------------------------------
const GHOST_INPUT_TYPES = new Set(['text', 'search', 'tel', 'email', 'url', 'number']);

function isGhostable(el) {
  if (el.disabled || el.readOnly) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return GHOST_INPUT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase());
}

// Style properties copied straight from the real field onto the ghost box so
// it lines up exactly, whatever context it's rendered in (a form-grid field,
// a toolbar search box, a dense table cell) without having to hand-maintain
// parallel CSS for each.
const COPIED_STYLE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantNumeric',
  'letterSpacing', 'lineHeight', 'textAlign',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius',
];

function wireGhost(el) {
  const key = fieldKey(el);
  if (!key || !FIELD_SOURCES[key]) return; // no master table backs this field — nothing to suggest
  el.dataset.acWired = '1';

  const isTextarea = el.tagName === 'TEXTAREA';
  const cs = getComputedStyle(el);
  // Only a flex-item parent (form fields, the toolbar) needs the wrapper to
  // take over sizing from the field; a plain container (e.g. a table cell)
  // should just have the wrapper hug the field's own natural size, so we
  // leave both alone there rather than risk a width:100%-inside-shrink-to-
  // fit circularity.
  const parentDisplay = getComputedStyle(el.parentNode).display;
  const inFlexParent = parentDisplay === 'flex' || parentDisplay === 'inline-flex';

  // Preserve the original field's participation in its parent's flex
  // layout (e.g. the toolbar search box's `flex: 1; max-width: 320px`) on
  // the new wrapper, since the wrapper — not the field itself — is now the
  // direct flex-item child taking that spot.
  const wrap = document.createElement('div');
  wrap.className = 'ac-wrap';
  if (inFlexParent) {
    wrap.style.flexGrow = cs.flexGrow;
    wrap.style.flexShrink = cs.flexShrink;
    wrap.style.flexBasis = cs.flexBasis;
    if (cs.maxWidth !== 'none') wrap.style.maxWidth = cs.maxWidth;
    if (cs.minWidth !== '0px') wrap.style.minWidth = cs.minWidth;
  }

  const ghost = document.createElement('div');
  ghost.className = 'ac-ghost' + (isTextarea ? ' ac-ghost-multiline' : '');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.innerHTML = '<span class="ac-ghost-typed"></span><span class="ac-ghost-suggest"></span>';
  COPIED_STYLE_PROPS.forEach((prop) => { ghost.style[prop] = cs[prop]; });

  el.parentNode.insertBefore(wrap, el);
  wrap.append(ghost, el);
  if (inFlexParent) {
    el.style.width = '100%';
    el.style.maxWidth = 'none';
  }
  el.style.background = 'transparent'; // let the ghost box's fill show through

  const typedSpan = ghost.querySelector('.ac-ghost-typed');
  const suggestSpan = ghost.querySelector('.ac-ghost-suggest');

  function syncGhostSize() {
    ghost.style.width = `${el.offsetWidth}px`;
    ghost.style.height = `${el.offsetHeight}px`;
  }
  syncGhostSize();
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncGhostSize).observe(el);
  }

  let suppressed = false; // Escape was pressed — don't re-show until next keystroke

  function updateGhost() {
    const typed = el.value;
    typedSpan.textContent = typed;
    const match = (!suppressed && document.activeElement === el && typed) ? bestMatch(key, typed) : null;
    if (match) {
      suggestSpan.textContent = match.slice(typed.length);
      el._acSuggestion = match;
    } else {
      suggestSpan.textContent = '';
      el._acSuggestion = null;
    }
  }

  function accept() {
    if (!el._acSuggestion) return;
    el.value = el._acSuggestion;
    updateGhost();
    if (typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* number inputs don't support text selection */ }
    }
  }

  el.addEventListener('input', () => { suppressed = false; updateGhost(); });
  el.addEventListener('focus', updateGhost);
  el.addEventListener('blur', updateGhost);

  el.addEventListener('keydown', (e) => {
    if (!el._acSuggestion) return;
    if (e.key === 'Escape') {
      suppressed = true;
      updateGhost();
    } else if (e.key === 'Tab') {
      accept(); // fill in the value, then let Tab move focus on as normal
    } else if (e.key === 'ArrowRight') {
      let atEnd = true;
      try { atEnd = el.selectionStart === el.value.length; } catch { /* number inputs don't support selectionStart */ }
      if (atEnd) {
        e.preventDefault();
        accept();
      }
    }
  });
}

// ----------------------------------------------------------------------------
// Date fields: "Use dd/mm/yyyy?" suggestion chip next to the BS picker
//
// Dates aren't master data the way a party or bank name is — there's no
// table to draw them from — so this one piece still keeps its own small
// per-field history in localStorage, most-recent first.
// ----------------------------------------------------------------------------
function readDateHistory(key) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function rememberDate(key, value) {
  if (!key) return;
  const v = String(value ?? '').trim();
  if (!v) return;
  try {
    const list = readDateHistory(key).filter((entry) => entry !== v);
    list.unshift(v);
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    // localStorage unavailable (private browsing quota, etc.) — the chip
    // just won't have anything to offer; nothing else depends on this.
  }
}

function fmtDdMmYyyy(iso) {
  const [y, m, d] = String(iso || '').split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function wireDateSuggestion(nativeInput) {
  if (nativeInput.disabled) return;
  const key = fieldKey(nativeInput);
  if (!key) return;
  nativeInput.dataset.acDateWired = '1';

  // bsDatePicker.js inserts its BS year/month/day selects as the very next
  // sibling of the native <input type="date"> — it must have already run
  // on this subtree for the chip to have anywhere to live.
  const bsField = nativeInput.nextElementSibling;
  if (!bsField || !bsField.classList.contains('bs-date-field')) return;
  const ySel = bsField.querySelector('.bs-date-year');
  const mSel = bsField.querySelector('.bs-date-month');
  const dSel = bsField.querySelector('.bs-date-day');
  if (!ySel || !mSel || !dSel) return;

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'ac-date-suggest';
  bsField.appendChild(chip);

  function refresh() {
    const last = nativeInput.value ? null : readDateHistory(key)[0];
    chip.hidden = !last;
    if (last) chip.textContent = `Use ${fmtDdMmYyyy(last)}?`;
  }

  chip.addEventListener('click', () => {
    const last = readDateHistory(key)[0];
    const bs = last && adToBs(last);
    if (!bs) return;
    // Drive the BS selects the same way the user would, so populateDays()/
    // commit() inside bsDatePicker.js do all the usual work (syncing the
    // native input's AD value, firing input/change on it for the rest of
    // the app) without this module needing access to that closure at all.
    ySel.value = String(bs.year);
    ySel.dispatchEvent(new Event('change', { bubbles: true }));
    mSel.value = String(bs.month);
    mSel.dispatchEvent(new Event('change', { bubbles: true }));
    dSel.value = String(bs.day);
    dSel.dispatchEvent(new Event('change', { bubbles: true }));
  });

  nativeInput.addEventListener('change', () => {
    rememberDate(key, nativeInput.value);
    refresh();
  });

  refresh();
}

// ----------------------------------------------------------------------------
export function initAutocomplete(root = document) {
  root.querySelectorAll('input, textarea').forEach((el) => {
    if (el.dataset.acWired || el.dataset.acDateWired) return;
    if (el.tagName === 'INPUT' && (el.getAttribute('type') || 'text').toLowerCase() === 'date') {
      wireDateSuggestion(el);
    } else if (isGhostable(el)) {
      wireGhost(el);
    }
  });
}
