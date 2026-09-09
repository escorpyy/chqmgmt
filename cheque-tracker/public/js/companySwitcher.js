import { API } from './constants.js';
import { escapeHtml } from './utils.js';
import { openModal, closeModal, formError, clearFormError } from './modal.js';

async function fetchCompanies() {
  const res = await fetch(`${API}/companies`, { credentials: 'include' });
  if (!res.ok) throw new Error('Could not load companies');
  return res.json();
}

async function createCompany(name) {
  const res = await fetch(`${API}/companies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Could not create company');
  return body;
}

async function selectCompany(companyId) {
  await fetch(`${API}/companies/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ companyId }),
  });
}

function openCreateCompanyModal({ dismissable }) {
  return new Promise((resolve) => {
    const body = `
      <form id="form-new-company">
        <div class="form-error"></div>
        <div class="form-grid">
          <div class="field span-2">
            <label>Company name *</label>
            <input name="name" type="text" required autofocus placeholder="e.g. B Enterprises Pvt. Ltd.">
          </div>
        </div>
        <div class="form-actions">
          ${dismissable ? '<button type="button" class="btn btn-ghost" id="cancel-new-company">Cancel</button>' : ''}
          <button type="submit" class="btn btn-primary">Create company</button>
        </div>
      </form>`;
    openModal('New company', body, {
      dismissable,
      onMount: () => {
        const form = document.getElementById('form-new-company');
        if (dismissable) {
          document.getElementById('cancel-new-company').addEventListener('click', () => {
            closeModal();
            resolve(null);
          });
        }
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          clearFormError(form);
          const name = new FormData(form).get('name');
          try {
            const company = await createCompany(name);
            closeModal();
            resolve(company);
          } catch (err) {
            formError(form, err.message);
          }
        });
      },
    });
  });
}

function render({ companies, selected }, onSwitched) {
  const host = document.getElementById('company-switcher');
  if (!host) return;

  const options = companies.map((c) => (
    `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  )).join('');
  const allOption = companies.length > 1
    ? `<option value="all" ${selected === 'all' ? 'selected' : ''}>All Companies</option>`
    : '';

  host.innerHTML = `
    <select id="company-select" title="Switch company">
      ${options}
      ${allOption}
      <option value="__new__">+ New company…</option>
    </select>`;

  document.getElementById('company-select').addEventListener('change', async (e) => {
    const value = e.target.value;
    if (value === '__new__') {
      e.target.value = selected; // snap the dropdown back until the modal resolves
      const company = await openCreateCompanyModal({ dismissable: true });
      if (company) {
        await selectCompany(company.id);
        onSwitched();
      }
      return;
    }
    await selectCompany(value);
    onSwitched();
  });
}

// Renders the header dropdown and guarantees a company is selected before
// resolving — the rest of main.js's init() depends on that, since every
// company-scoped API route 409s until a selection exists in session.
export async function initCompanySwitcher() {
  let data = await fetchCompanies();

  if (data.companies.length === 0) {
    // Brand new user, or their companies were somehow all removed —
    // nothing to switch between yet, so this modal can't be dismissed.
    const company = await openCreateCompanyModal({ dismissable: false });
    await selectCompany(company.id);
    data = await fetchCompanies();
  } else if (!data.selected) {
    // Companies exist but none is selected yet in this session — default to
    // the first rather than blocking the whole app on a dropdown click.
    await selectCompany(data.companies[0].id);
    data = await fetchCompanies();
  }

  render(data, () => window.location.reload());
  return data.selected;
}
