import { API } from './constants.js';
import { toast } from './toast.js';
import { escapeHtml } from './utils.js';
import { loadReferenceData } from './referenceData.js';

// ============================================================================
// IMPORT / EXPORT
// ============================================================================
// Talks to routes/importExport.js directly with fetch() rather than the
// shared api() helper, for two reasons: export/sample downloads are binary
// (not JSON) and are just opened in a new tab, and the import request is
// multipart/form-data, which needs the browser to set its own Content-Type
// with a boundary — api() always forces 'application/json'.

// Decodes a base64 string into a Blob and triggers a browser download for it.
function downloadBase64(base64, filename, mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
  downloadBlob(new Blob([buffer], { type: mimeType }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function filenameFromContentDisposition(header, fallback) {
  const match = /filename="?([^"]+)"?/.exec(header || '');
  return match ? match[1] : fallback;
}

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
      <div class="ie-export-result"></div>
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

    const exportBtn = card.querySelector('[data-action="export"]');
    const exportResultEl = card.querySelector('.ie-export-result');

    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      exportResultEl.innerHTML = `<p class="hint">Exporting…</p>`;
      try {
        const res = await fetch(`${API}/import-export/${key}/export`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Export failed (${res.status})`);
        }
        const rowErrors = Number(res.headers.get('X-Row-Errors') || '0');
        const filename = filenameFromContentDisposition(res.headers.get('Content-Disposition'), `${key}.xlsx`);
        const blob = await res.blob();
        downloadBlob(blob, filename);

        if (rowErrors > 0) {
          exportResultEl.innerHTML = `
            <p class="hint">${rowErrors} row${rowErrors === 1 ? '' : 's'} could not be exported and ${rowErrors === 1 ? 'was' : 'were'} skipped.</p>
            <button type="button" class="btn btn-sm btn-ghost" data-action="export-errors">Download error report</button>
          `;
          exportResultEl.querySelector('[data-action="export-errors"]').addEventListener('click', async (btnEvent) => {
            const reportBtn = btnEvent.target;
            reportBtn.disabled = true;
            try {
              const reportRes = await fetch(`${API}/import-export/${key}/export-errors`);
              if (!reportRes.ok) throw new Error(`Could not build the error report (${reportRes.status})`);
              const reportFilename = filenameFromContentDisposition(reportRes.headers.get('Content-Disposition'), `${key}-export-errors.xlsx`);
              downloadBlob(await reportRes.blob(), reportFilename);
            } catch (err) {
              toast(err.message, 'error');
            } finally {
              reportBtn.disabled = false;
            }
          });
          toast(`Exported with ${rowErrors} row(s) skipped`, 'error');
        } else {
          exportResultEl.innerHTML = '';
          toast('Export complete', 'success');
        }
      } catch (err) {
        exportResultEl.innerHTML = '';
        toast(err.message, 'error');
      } finally {
        exportBtn.disabled = false;
      }
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
          ${body.errorReport ? `<button type="button" class="btn btn-sm btn-ghost" data-action="import-errors">Download error report</button>` : ''}
        `;
        if (body.errorReport) {
          resultEl.querySelector('[data-action="import-errors"]').addEventListener('click', () => {
            downloadBase64(body.errorReport.base64, body.errorReport.filename);
          });
        }
        toast(body.failed ? `Imported with ${body.failed} error(s)` : 'Import complete', body.failed ? 'error' : 'success');
        form.reset();
        warning.classList.remove('show');

        // Comboboxes across the app (issuer, payee, bank, staff, fiscal year…)
        // read from the shared reference-data cache, which is only populated
        // once at page load — without this, newly imported rows exist in the
        // DB and show up on their own tab, but silently don't appear as
        // suggestions anywhere else until a full page reload.
        if (body.created > 0) {
          try {
            await loadReferenceData();
          } catch (err) {
            toast(`Imported, but could not refresh dropdowns: ${err.message}. Reload the page to see the new entries everywhere.`, 'error');
          }
        }
      } catch (err) {
        resultEl.innerHTML = '';
        toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  });
}
