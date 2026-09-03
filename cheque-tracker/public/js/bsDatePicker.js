// ============================================================================
// BS (Bikram Sambat) date picker
//
// This app is Nepal-based, so date *entry* should be BS-first too, not just
// display. Browsers only speak Gregorian for native <input type="date">, so
// this module finds every such input, keeps it as the source of truth
// (still carries the real `name` attribute the app's forms read via
// `new FormData(form)`, and still stores/validates an AD ISO value — so
// every existing submit handler, API call, and date calculation elsewhere
// in the app is untouched), but hides its native calendar UI and replaces
// it with three BS year/month/day <select>s plus a small AD cross-reference.
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
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Wire a BS-first picker onto every not-yet-wired <input type="date">
 * found inside `root`. Safe to call repeatedly (e.g. every time a modal or
 * drawer is opened) — already-wired inputs are skipped.
 */
export function initBsDatePickers(root = document) {
  root.querySelectorAll('input[type="date"]:not([data-bs-wired])').forEach(wireOne);
}

/** Re-sync a single picker's BS selects from its native input's current AD value. */
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
