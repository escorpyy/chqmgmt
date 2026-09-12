import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(__dirname, 'data');
const configPath = path.join(configDir, 'connection.json');
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);

async function readSavedConfig() {
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function connectionString({ host, port: dbPort, database, username, password }) {
  const user = encodeURIComponent(username);
  const secret = encodeURIComponent(password);
  return `postgresql://${user}:${secret}@${host}:${dbPort}/${encodeURIComponent(database)}`;
}

async function testConnection(details) {
  const client = new Client({ connectionString: connectionString(details), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyConnectionError(err) };
  } finally {
    await client.end().catch(() => {});
  }
}

function friendlyConnectionError(err) {
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(err.code)) {
    return 'PostgreSQL could not be reached at this host and port.';
  }
  if (err.code === '28P01') return 'PostgreSQL rejected the username or password.';
  if (err.code === '3D000') return 'The database does not exist.';
  return err.message || 'Could not connect to PostgreSQL.';
}

function createConfig(details) {
  return {
    host: details.host,
    port: Number(details.port),
    database: details.database,
    username: details.username,
    password: details.password,
    sessionSecret: crypto.randomBytes(32).toString('hex'),
  };
}

async function saveConfig(saved) {
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(configPath, 0o600).catch(() => {});
  return saved;
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: __dirname,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', () => reject(new Error(`${label} could not be started.`)));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}.`));
    });
  });
}

async function runDatabaseSetup() {
  const prismaCli = path.join(__dirname, 'node_modules', 'prisma', 'build', 'index.js');
  await runCommand(process.execPath, [prismaCli, 'migrate', 'deploy'], 'Prisma migrations');
  await runCommand(process.execPath, ['scripts/apply-manual-migration.js'], 'Database safety constraints');
}

function applyConfig(config) {
  process.env.DATABASE_URL = connectionString(config);
  process.env.SESSION_SECRET = config.sessionSecret;
}

function startSetupServer() {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/setup/scan', async (req, res) => {
    const ports = [5432, 5433, 5434];
    const results = await Promise.all(ports.map(async (candidatePort) => {
      const client = new Client({ host: '127.0.0.1', port: candidatePort, connectionTimeoutMillis: 700 });
      try {
        await client.connect();
        return { port: candidatePort, available: true };
      } catch {
        return { port: candidatePort, available: false };
      } finally {
        await client.end().catch(() => {});
      }
    }));
    res.json({ results });
  });
  app.post('/api/setup/test', async (req, res) => {
    const details = normalizeDetails(req.body);
    const validationError = validateDetails(details);
    if (validationError) return res.status(400).json({ error: validationError });
    res.json(await testConnection(details));
  });
  app.post('/api/setup/save', async (req, res) => {
    const details = normalizeDetails(req.body);
    const validationError = validateDetails(details);
    if (validationError) return res.status(400).json({ error: validationError });
    const result = await testConnection(details);
    if (!result.ok) return res.status(400).json(result);
    const saved = createConfig(details);
    applyConfig(saved);
    try {
      await runDatabaseSetup();
    } catch (err) {
      delete process.env.DATABASE_URL;
      delete process.env.SESSION_SECRET;
      return res.status(500).json({ error: `${err.message} The connection was not saved.` });
    }
    await saveConfig(saved);
    res.json({ ok: true, message: 'Connection saved. Starting the application.' });
    server.close(async () => {
      await startApplication();
    });
  });
  app.use((req, res, next) => {
    const allowed = req.path === '/setup.html' || req.path === '/style.css' || req.path === '/js/setup.js' || req.path.startsWith('/api/setup/');
    if (allowed) return next();
    return res.sendFile(path.join(publicDir, 'setup.html'));
  });
  app.use(express.static(publicDir));
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'setup.html')));
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Setup screen available at http://localhost:${port}/setup.html`);
  });
  return server;
}

function normalizeDetails(body) {
  return {
    host: String(body.host || '').trim(),
    port: String(body.port || '').trim(),
    database: String(body.database || '').trim(),
    username: String(body.username || '').trim(),
    password: String(body.password || ''),
  };
}

function validateDetails(details) {
  if (!details.host || !details.database || !details.username || !details.password) {
    return 'Host, port, database, username, and password are required.';
  }
  const dbPort = Number(details.port);
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) return 'Port must be a valid number from 1 to 65535.';
  details.port = dbPort;
  return null;
}

async function startApplication() {
  await import('./server.js');
}

async function prepareAndStartApplication() {
  await runDatabaseSetup();
  await startApplication();
}

async function main() {
  let config = await readSavedConfig();
  if (!config && process.env.DATABASE_URL && process.env.SESSION_SECRET) {
    await prepareAndStartApplication();
    return;
  }
  if (config) {
    applyConfig(config);
    const result = await testConnection(config);
    if (result.ok && process.env.SESSION_SECRET) {
      await prepareAndStartApplication();
      return;
    }
    console.warn(`Saved PostgreSQL connection is unavailable: ${result.error}`);
  }
  startSetupServer();
}

main().catch((err) => {
  console.error(`Could not start Cheque Register: ${err.message}`);
  process.exit(1);
});