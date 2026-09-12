import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'backup-settings.json');
const DEFAULT_SETTINGS = { enabled: true, intervalHours: 24, retentionCount: 14 };
let schedulerTimer;

function databaseEnv() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  const url = new URL(process.env.DATABASE_URL);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

function postgresTool(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function runTool(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: databaseEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout.resume();
    child.on('error', (err) => reject(new Error(`${label} could not start: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${label} failed${stderr.trim() ? `: ${redact(stderr.trim())}` : '.'}`));
    });
  });
}

function redact(message) {
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'PostgreSQL connection').replace(/password[=:][^\s]+/gi, 'password=[redacted]');
}

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(BACKUP_DIR, 0o700).catch(() => {});
}

export async function readBackupSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_SETTINGS };
    throw err;
  }
}

export async function writeBackupSettings(input) {
  const settings = {
    enabled: input.enabled !== false,
    intervalHours: Math.min(168, Math.max(1, Number(input.intervalHours) || DEFAULT_SETTINGS.intervalHours)),
    retentionCount: Math.min(100, Math.max(1, Number(input.retentionCount) || DEFAULT_SETTINGS.retentionCount)),
  };
  await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(SETTINGS_PATH, 0o600).catch(() => {});
  return settings;
}

export async function listBackups() {
  await ensureBackupDir();
  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.dump')) continue;
    const fullPath = path.join(BACKUP_DIR, entry.name);
    const stat = await fs.stat(fullPath);
    backups.push({ name: entry.name, size: stat.size, createdAt: stat.birthtime.toISOString(), path: fullPath });
  }
  return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function createBackup(reason = 'manual') {
  await ensureBackupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeReason = String(reason).replace(/[^a-z0-9_-]/gi, '-').slice(0, 24) || 'manual';
  const fileName = `cheque-tracker-${stamp}-${safeReason}-${crypto.randomBytes(3).toString('hex')}.dump`;
  const filePath = path.join(BACKUP_DIR, fileName);
  try {
    await runTool(postgresTool('pg_dump'), ['--format=custom', '--no-owner', '--file', filePath], 'PostgreSQL backup');
    const [backup] = (await listBackups()).filter((item) => item.name === fileName);
    return backup;
  } catch (err) {
    await fs.rm(filePath, { force: true }).catch(() => {});
    throw err;
  }
}

export async function restoreBackup(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${path.resolve(BACKUP_DIR)}${path.sep}`)) {
    throw new Error('Restore file must be inside the backup storage directory.');
  }
  await fs.access(resolved);
  await runTool(postgresTool('pg_restore'), ['--exit-on-error', '--clean', '--if-exists', '--no-owner', '--dbname', process.env.DATABASE_URL, resolved], 'PostgreSQL restore');
}

export async function restoreUploadedBackup(filePath) {
  await ensureBackupDir();
  const safeName = `uploaded-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.dump`;
  const storedPath = path.join(BACKUP_DIR, safeName);
  await fs.copyFile(filePath, storedPath);
  try {
    await runTool(postgresTool('pg_restore'), ['--exit-on-error', '--clean', '--if-exists', '--no-owner', '--dbname', process.env.DATABASE_URL, storedPath], 'PostgreSQL restore');
    return (await listBackups()).find((item) => item.name === safeName);
  } finally {
    await fs.rm(filePath, { force: true }).catch(() => {});
  }
}

export async function enforceRetention() {
  const settings = await readBackupSettings();
  const backups = await listBackups();
  for (const backup of backups.slice(settings.retentionCount)) await fs.rm(backup.path, { force: true });
}

export async function runScheduledBackup() {
  const settings = await readBackupSettings();
  if (!settings.enabled) return null;
  const backup = await createBackup('scheduled');
  await enforceRetention();
  return backup;
}

export async function startBackupScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  const settings = await readBackupSettings();
  schedulerTimer = setInterval(() => {
    runScheduledBackup().catch((err) => console.error(`Scheduled backup failed: ${err.message}`));
  }, settings.intervalHours * 60 * 60 * 1000);
  schedulerTimer.unref?.();
}