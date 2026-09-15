// ============================================================================
// Record-form toolbar
//
// A small reusable toolbar rendered at the top of the received/issued cheque
// form modal (see renderReceivedFormModal / renderIssuedFormModal). Three
// groups:
//   - left:   New / Edit / Delete — mode toggles for the record on screen
//   - middle: ‹ prev/next › — walks the record forward/back through the
//             currently filtered+sorted list (not just the loaded page)
//   - right:  Copy / Paste — round-trips the form's field values through the
//             OS clipboard as JSON, so a similar record can be duplicated
//
// This module only builds/wires the DOM — it has no idea what a "cheque" is.
// Callers (received.js / issued.js) own the field data, the mode machine,
// and what each button actually does.
// ============================================================================

export function toolbarHtml() {
  return `
    <div class="form-toolbar">
      <div class="ft-group ft-left">
        <button type="button" class="btn btn-sm" data-ft="new" title="Start a new record">+ New</button>
        <button type="button" class="btn btn-sm" data-ft="edit" title="Edit this record">Edit</button>
        <button type="button" class="btn btn-sm btn-danger" data-ft="delete" title="Delete this record">Delete</button>
      </div>
      <div class="ft-group ft-nav">
        <button type="button" class="btn btn-sm btn-icon" data-ft="prev" aria-label="Previous record" title="Previous record">‹</button>
        <span class="ft-position"></span>
        <button type="button" class="btn btn-sm btn-icon" data-ft="next" aria-label="Next record" title="Next record">›</button>
      </div>
      <div class="ft-group ft-right">
        <button type="button" class="btn btn-sm" data-ft="copy" title="Copy this record to the clipboard">Copy</button>
        <button type="button" class="btn btn-sm" data-ft="paste" title="Paste a copied record into this form">Paste</button>
      </div>
    </div>`;
}

// handlers: { new, edit, delete, prev, next, copy, paste } — each optional,
// called with no arguments on click.
export function wireToolbar(root, handlers = {}) {
  root.querySelectorAll('[data-ft]').forEach((btn) => {
    btn.addEventListener('click', () => handlers[btn.dataset.ft]?.());
  });
}

// mode: 'view' | 'edit' | 'new'. position/total: 0-based index and count
// within the current filtered/sorted list — omit both for 'new'.
export function setToolbarState(root, { mode, position = null, total = null }) {
  const isNew = mode === 'new';
  const isView = mode === 'view';

  const editBtn = root.querySelector('[data-ft="edit"]');
  const deleteBtn = root.querySelector('[data-ft="delete"]');
  const pasteBtn = root.querySelector('[data-ft="paste"]');
  const prevBtn = root.querySelector('[data-ft="prev"]');
  const nextBtn = root.querySelector('[data-ft="next"]');
  const posEl = root.querySelector('.ft-position');

  if (editBtn) editBtn.disabled = !isView;
  if (deleteBtn) deleteBtn.disabled = isNew;
  if (pasteBtn) pasteBtn.disabled = isView; // nothing editable to paste into yet — click Edit first

  const hasPosition = !isNew && position != null && position >= 0;
  if (prevBtn) prevBtn.disabled = !hasPosition || position <= 0;
  if (nextBtn) nextBtn.disabled = !hasPosition || !total || position >= total - 1;
  if (posEl) posEl.textContent = isNew ? 'New record' : (hasPosition && total ? `${position + 1} / ${total}` : '');
}

// Serializes `data` (plain object) to the clipboard as JSON, tagged with
// `type` so paste can refuse to cross-wire e.g. an issued cheque into the
// received-cheque form. Returns true/false instead of throwing, since
// clipboard access can be denied by the browser and callers just need to
// toast about it.
export async function copyRecordToClipboard(type, data) {
  try {
    await navigator.clipboard.writeText(JSON.stringify({ __type: type, ...data }, null, 2));
    return true;
  } catch {
    return false;
  }
}

// Reads the clipboard and returns the parsed object only if it's JSON
// tagged with the expected `type`; otherwise returns null (caller decides
// what to tell the user — empty/foreign clipboard vs. wrong record type
// look the same from here, so it just returns null for both).
export async function readRecordFromClipboard(type) {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(text);
    if (!data || data.__type !== type) return null;
    delete data.__type;
    return data;
  } catch {
    return null;
  }
}
