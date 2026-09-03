import { API } from './constants.js';
import { toast } from './toast.js';
import { escapeHtml } from './utils.js';

// ============================================================================
// IMPORT / EXPORT
// ============================================================================
// Talks to routes/importExport.js directly with fetch() rather than the
// shared api() helper, for two reasons: export/sample downloads are binary
// (not JSON) and are just opened in a new tab, and the import request is
// multipart/form-data, which needs the browser to set its own Content-Type
// with a boundary — api() always forces 'application/json'.

export async function loadImportExport() {
  const el = document.getElementById('importexport-list');
  try {
    const tables = await fetch(`${API}/import-export/tables`).then(async (res) => {
      if (!res.ok) throw new Error(`Could not load tables (${res.status})`);
      return res.json();
    });
    renderImportExportGrid(tables);
  } catch (err) {
    el.innerHTML = '';
    toast(err.message, 'error');
  }
}

function renderImportExportGrid(tables) {
  const el = document.getElementById('importexport-list');
  if (!tables.length) {
    el.innerHTML = `<p class="hint">No importable/exportable tables are configured.</p>`;
    return;
  }

  el.innerHTML = tables.map((t) => `
    <div class="ie-card" data-key="${t.key}">
      <div class="ie-card-head">
        <h3>${escapeHtml(t.label)}</h3>
      </div>
      <p class="ie-columns">${t.columns.map(escapeHtml).join(', ')}</p>
      <div class="ie-actions">
        <button class="btn btn-sm" data-action="export">Export</button>
        <button class="btn btn-sm btn-ghost" data-action="sample">Download sample</button>
      </div>
      <form class="ie-import-form">
        <label class="ie-import-label">Import from Excel</label>
        <div class="ie-import-row">
          <input type="file" accept=".xlsx,.xls" required>
          <select name="mode">
            <option value="append">Append</option>
            <option value="replace">Delete existing, then import</option>
          </select>
          <button type="submit" class="btn btn-sm btn-primary">Import</button>
        </div>
        <p class="ie-replace-warning">This deletes every existing row in this table before importing. It will fail if other tables still reference rows being deleted.</p>
        <div class="ie-result"></div>
      </form>
    </div>
  `).join('');

  el.querySelectorAll('.ie-card').forEach((card) => {
    const key = card.dataset.key;

    card.querySelector('[data-action="export"]').addEventListener('click', () => {
      window.open(`${API}/import-export/${key}/export`, '_blank');
    });
    card.querySelector('[data-action="sample"]').addEventListener('click', () => {
      window.open(`${API}/import-export/${key}/sample`, '_blank');
    });

    const form = card.querySelector('.ie-import-form');
    const modeSelect = form.querySelector('select[name="mode"]');
    const warning = form.querySelector('.ie-replace-warning');
    const resultEl = form.querySelector('.ie-result');

    modeSelect.addEventListener('change', () => {
      warning.classList.toggle('show', modeSelect.value === 'replace');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = form.querySelector('input[type="file"]');
      const file = fileInput.files[0];
      if (!file) return;

      if (modeSelect.value === 'replace' && !confirm(`This will delete ALL existing rows in "${key}" before importing. Continue?`)) {
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      resultEl.innerHTML = `<p class="hint">Importing…</p>`;

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', modeSelect.value);

        const res = await fetch(`${API}/import-export/${key}/import`, { method: 'POST', body: formData });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Import failed (${res.status})`);

        resultEl.innerHTML = `
          <p class="hint">
            ${body.created} of ${body.totalRows} row${body.totalRows === 1 ? '' : 's'} imported
            ${body.deletedAll ? ' (existing rows were deleted first)' : ''}.
            ${body.failed ? `${body.failed} failed.` : ''}
          </p>
          ${body.errors.length ? `<ul class="ie-error-list">${body.errors.map((er) => `<li>Row ${er.row}: ${escapeHtml(er.message)}</li>`).join('')}</ul>` : ''}
        `;
        toast(body.failed ? `Imported with ${body.failed} error(s)` : 'Import complete', body.failed ? 'error' : 'success');
        form.reset();
        warning.classList.remove('show');
      } catch (err) {
        resultEl.innerHTML = '';
        toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  });
}
