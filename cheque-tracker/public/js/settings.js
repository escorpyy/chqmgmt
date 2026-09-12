import { API } from './constants.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { escapeHtml, fmtDate } from './utils.js';

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function render({ settings, backups }) {
  const el = document.getElementById('settings-content');
  el.innerHTML = `
    <div class="settings-grid">
      <section class="settings-card">
        <h3>Automated backups</h3>
        <p class="hint">Backups run on this application server and are stored locally. Keep a separate copy on another disk or secure storage.</p>
        <form id="backup-settings-form">
          <label class="checkbox-field"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}> Enable scheduled backups</label>
          <div class="form-grid">
            <div class="field"><label>Interval (hours)</label><input name="intervalHours" type="number" min="1" max="168" value="${settings.intervalHours}" required></div>
            <div class="field"><label>Keep newest backups</label><input name="retentionCount" type="number" min="1" max="100" value="${settings.retentionCount}" required></div>
          </div>
          <button class="btn btn-primary" type="submit">Save backup settings</button>
        </form>
        <button class="btn" id="create-backup" type="button">Create backup now</button>
      </section>
      <section class="settings-card">
        <h3>Restore database</h3>
        <p class="warning-text"><strong>Warning:</strong> restoring replaces current database contents. A safety backup is created automatically immediately before restore.</p>
        <form id="restore-form">
          <div class="field"><label for="restore-file">PostgreSQL backup file</label><input id="restore-file" name="backup" type="file" accept=".dump,application/octet-stream" required></div>
          <div class="field"><label for="restore-confirm">Type RESTORE to confirm</label><input id="restore-confirm" name="confirm" autocomplete="off" required></div>
          <button class="btn btn-danger" type="submit">Restore database</button>
        </form>
      </section>
    </div>
    <section class="settings-card">
      <h3>Available backups</h3>
      <div id="backup-list">
        ${backups.length ? `<ul class="backup-list">${backups.map((backup) => `
          <li><span><strong>${escapeHtml(backup.name)}</strong><small>${fmtDate(backup.createdAt)} · ${formatBytes(backup.size)}</small></span><a class="btn btn-sm" href="${API}/backups/${encodeURIComponent(backup.name)}/download">Download</a></li>`).join('')}</ul>` : '<p class="hint">No backups have been created yet.</p>'}
      </div>
    </section>`;

  document.getElementById('backup-settings-form').addEventListener('submit', saveSettings);
  document.getElementById('create-backup').addEventListener('click', createBackup);
  document.getElementById('restore-form').addEventListener('submit', restoreDatabase);
}

export async function loadSettings() {
  try {
    const data = await api('/backups');
    render(data);
  } catch (err) {
    document.getElementById('settings-content').innerHTML = `<p class="form-error show">${escapeHtml(err.message)}</p>`;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  data.enabled = event.currentTarget.elements.enabled.checked;
  try {
    await api('/backups/settings', { method: 'PATCH', body: JSON.stringify(data) });
    toast('Backup settings saved', 'success');
    loadSettings();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function createBackup() {
  const button = document.getElementById('create-backup');
  button.disabled = true;
  try {
    await api('/backups', { method: 'POST' });
    toast('Backup created', 'success');
    loadSettings();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function restoreDatabase(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.confirm.value.trim() !== 'RESTORE') {
    toast('Type RESTORE exactly to confirm', 'error');
    return;
  }
  if (!window.confirm('This will replace the current database. A safety backup will be created first. Continue?')) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch(`${API}/backups/restore`, { method: 'POST', body: new FormData(form), credentials: 'include' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Restore failed');
    toast(body.message || 'Database restored', 'success');
    form.reset();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}