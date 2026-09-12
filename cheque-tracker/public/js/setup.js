const form = document.getElementById('setup-form');
const errorEl = document.getElementById('setup-error');
const statusEl = document.getElementById('setup-status');
const connectButton = document.getElementById('connect-button');
const scanButton = document.getElementById('scan-ports');

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `setup-status${type ? ` ${type}` : ''}`;
}

function clearError() {
  errorEl.textContent = '';
  errorEl.classList.remove('show');
}

function setValue(name, value) {
  const input = form.elements[name];
  if (input && value !== undefined) input.value = value;
}

scanButton.addEventListener('click', async () => {
  clearError();
  setStatus('Checking common local PostgreSQL ports…');
  scanButton.disabled = true;
  try {
    const res = await fetch('/api/setup/scan');
    const body = await res.json();
    const available = body.results?.find((candidate) => candidate.available);
    if (!available) {
      setStatus('No PostgreSQL service was found on ports 5432–5434.', 'error');
      return;
    }
    setValue('host', 'localhost');
    setValue('port', available.port);
    setStatus(`PostgreSQL responded on port ${available.port}. Enter credentials and continue.`, 'success');
  } catch {
    setStatus('Could not scan for PostgreSQL.', 'error');
  } finally {
    scanButton.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  setStatus('Testing the PostgreSQL connection…');
  connectButton.disabled = true;
  scanButton.disabled = true;
  const details = Object.fromEntries(new FormData(form).entries());
  try {
    const test = await fetch('/api/setup/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details),
    });
    const testBody = await test.json();
    if (!test.ok || !testBody.ok) throw new Error(testBody.error || 'Could not connect to PostgreSQL.');

    setStatus('Connection verified. Applying database migrations and safety constraints…');
    const save = await fetch('/api/setup/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details),
    });
    const saveBody = await save.json();
    if (!save.ok || !saveBody.ok) throw new Error(saveBody.error || 'Could not save the connection.');
    setStatus('Connected. Starting the login screen…', 'success');
    window.setTimeout(() => { window.location.href = 'login.html'; }, 700);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('show');
    setStatus('Connection was not saved.', 'error');
    connectButton.disabled = false;
    scanButton.disabled = false;
  }
});