// ============================================================================
// BS (Bikram Sambat) date picker
//
// This app is Nepal-based, so date *entry* should be BS-first too, not just
// display. Browsers only speak Gregorian for native <input type="date">, so
// this module finds every such input, keeps it as the source of truth
// (still carries the real `name` attribute the app's forms read via
// `new FormData(form)`, and still stores/validates an AD ISO value — so
// every existing submit handler, API call, and date calculation elsewhere
// in the app is untouched), but hides its native calendar UI and replaces it
// with a BS-first picker.
//
// Two picker modes, chosen per-input:
//  - default: three year/month/day <select>s plus a small AD cross-reference
//    (spacious, used on create/edit forms throughout the app).
//  - `data-bs-mode="text"`: a single dd/mm/yyyy (BS) text input — opt-in,
//    for places like a compact filter strip where three selects don't fit.
//
// The native input stays in the DOM (not display:none, not type="hidden")
// specifically so HTML5 "required" constraint validation keeps working —
// this is the standard "visually hidden but focusable" pattern.
// ============================================================================

import { adToBs, bsToAd, daysInBsMonth, BS_MONTHS } from './nepaliDate.js';

const BS_YEAR_MIN = 2000;
const BS_YEAR_MAX = 2090;

function fmtAdShort(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** "17/05/2083" for a { year, month (0-based), day } BS triple. */
function fmtBsSlash(bs) {
  return `${pad2(bs.day)}/${pad2(bs.month + 1)}/${bs.year}`;
}

/**
 * Parse a typed "dd/mm/yyyy" (BS) string into { year, month, day } (month
 * 0-based), or null if it isn't well-formed or isn't a real BS date.
 */
function parseBsSlash(text) {
  const m = String(text).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const year = Number(m[3]);
  const max = daysInBsMonth(year, month);
  if (!max || day < 1 || day > max) return null;
  return { year, month, day };
}

/**
 * Wire a BS-first picker onto every not-yet-wired <input type="date">
 * found inside `root`. Safe to call repeatedly (e.g. every time a modal or
 * drawer is opened) — already-wired inputs are skipped.
 */
export function initBsDatePickers(root = document) {
  root.querySelectorAll('input[type="date"]:not([data-bs-wired])').forEach((el) => {
    if (el.dataset.bsMode === 'text') wireOneText(el);
    else wireOne(el);
  });
}

/** Re-sync a single picker's BS input(s) from its native input's current AD value. */
export function syncBsDatePicker(nativeInput) {
  nativeInput?._bsSync?.();
}

function wireOne(nativeInput) {
  nativeInput.dataset.bsWired = '1';
  nativeInput.classList.add('bs-native-date');
  nativeInput.tabIndex = -1; // the BS selects below are the real interactive controls

  const wrap = document.createElement('div');
  wrap.className = 'bs-date-field';

  const ySel = document.createElement('select');
  const mSel = document.createElement('select');
  const dSel = document.createElement('select');
  ySel.className = 'bs-date-select bs-date-year';
  mSel.className = 'bs-date-select bs-date-month';
  dSel.className = 'bs-date-select bs-date-day';
  ySel.setAttribute('aria-label', 'BS year');
  mSel.setAttribute('aria-label', 'BS month');
  dSel.setAttribute('aria-label', 'BS day');

  ySel.appendChild(new Option('Year (BS)', ''));
  for (let y = BS_YEAR_MIN; y <= BS_YEAR_MAX; y++) ySel.appendChild(new Option(String(y), String(y)));

  mSel.appendChild(new Option('Month', ''));
  BS_MONTHS.forEach((name, i) => mSel.appendChild(new Option(name, String(i))));

  dSel.appendChild(new Option('Day', ''));

  const todayBtn = document.createElement('button');
  todayBtn.type = 'button';
  todayBtn.className = 'btn btn-ghost btn-sm bs-date-today';
  todayBtn.textContent = 'Today';

  const adHint = document.createElement('span');
  adHint.className = 'bs-date-hint';

  wrap.append(ySel, mSel, dSel, todayBtn, adHint);
  nativeInput.insertAdjacentElement('afterend', wrap);

  function populateDays(yStr, mStr, keepDayStr) {
    const prev = keepDayStr !== undefined ? keepDayStr : dSel.value;
    dSel.innerHTML = '';
    dSel.appendChild(new Option('Day', ''));
    if (yStr === '' || mStr === '') return;
    const max = daysInBsMonth(Number(yStr), Number(mStr));
    if (!max) return;
    for (let d = 1; d <= max; d++) dSel.appendChild(new Option(String(d), String(d)));
    if (prev !== '' && Number(prev) <= max) dSel.value = prev;
  }

  function commit() {
    if (ySel.value === '' || mSel.value === '' || dSel.value === '') {
      nativeInput.value = '';
      adHint.textContent = '';
    } else {
      const ad = bsToAd(Number(ySel.value), Number(mSel.value), Number(dSel.value));
      if (ad) {
        const iso = ad.toISOString().slice(0, 10);
        nativeInput.value = iso;
        adHint.textContent = `(${fmtAdShort(iso)})`;
      }
    }
    // Let the rest of the app (submit handlers, other listeners) react as if
    // the user had picked the AD date directly on the native input.
    nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
    nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  ySel.addEventListener('change', () => { populateDays(ySel.value, mSel.value); commit(); });
  mSel.addEventListener('change', () => { populateDays(ySel.value, mSel.value); commit(); });
  dSel.addEventListener('change', commit);
  todayBtn.addEventListener('click', () => {
    const bs = adToBs(new Date());
    if (!bs) return;
    ySel.value = String(bs.year);
    mSel.value = String(bs.month);
    populateDays(String(bs.year), String(bs.month), String(bs.day));
    dSel.value = String(bs.day);
    commit();
  });

  function syncFromNative() {
    const val = nativeInput.value;
    if (!val) {
      ySel.value = '';
      mSel.value = '';
      populateDays('', '');
      adHint.textContent = '';
      return;
    }
    const bs = adToBs(val);
    if (!bs) {
      // Outside the supported BS 2000–2090 range — fall back to showing AD only.
      ySel.value = '';
      mSel.value = '';
      populateDays('', '');
      adHint.textContent = fmtAdShort(val);
      return;
    }
    ySel.value = String(bs.year);
    mSel.value = String(bs.month);
    populateDays(String(bs.year), String(bs.month), String(bs.day));
    dSel.value = String(bs.day);
    adHint.textContent = `(${fmtAdShort(val)})`;
  }

  // Exposed so callers that set `nativeInput.value` programmatically (which
  // doesn't fire 'change') can ask the picker to refresh — e.g. a "default
  // to today" date field.
  nativeInput._bsSync = syncFromNative;
  syncFromNative();
}

/**
 * Single dd/mm/yyyy (BS) text-input variant — same native-input-as-source-
 * of-truth contract as wireOne() above, just a single field instead of
 * three selects. Opt in per-input with data-bs-mode="text".
 */
function wireOneText(nativeInput) {
  nativeInput.dataset.bsWired = '1';
  nativeInput.classList.add('bs-native-date');
  nativeInput.tabIndex = -1; // the text input below is the real interactive control

  const wrap = document.createElement('div');
  wrap.className = 'bs-date-field-text';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'bs-date-text-input';
  input.placeholder = 'dd/mm/yyyy';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', nativeInput.title || 'Date (BS, dd/mm/yyyy)');

  const adHint = document.createElement('span');
  adHint.className = 'bs-date-hint';

  wrap.append(input, adHint);
  nativeInput.insertAdjacentElement('afterend', wrap);

  function commitFromText() {
    const typed = input.value.trim();
    if (typed === '') {
      nativeInput.value = '';
      adHint.textContent = '';
      input.classList.remove('invalid');
    } else {
      const bs = parseBsSlash(typed);
      const ad = bs && bsToAd(bs.year, bs.month, bs.day);
      if (ad) {
        const iso = ad.toISOString().slice(0, 10);
        nativeInput.value = iso;
        adHint.textContent = `(${fmtAdShort(iso)})`;
        input.classList.remove('invalid');
      } else {
        // Unparseable or out-of-range — leave the underlying date alone
        // (so a bad keystroke mid-edit doesn't silently wipe a valid
        // filter) but flag the field so it's visibly not applied yet.
        input.classList.add('invalid');
        return;
      }
    }
    nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
    nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.addEventListener('change', commitFromText);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitFromText(); input.blur(); }
  });

  function syncFromNative() {
    const val = nativeInput.value;
    input.classList.remove('invalid');
    if (!val) {
      input.value = '';
      adHint.textContent = '';
      return;
    }
    const bs = adToBs(val);
    if (!bs) {
      // Outside the supported BS 2000–2090 range — fall back to AD only.
      input.value = '';
      adHint.textContent = fmtAdShort(val);
      return;
    }
    input.value = fmtBsSlash(bs);
    adHint.textContent = `(${fmtAdShort(val)})`;
  }

  nativeInput._bsSync = syncFromNative;
  syncFromNative();
}
