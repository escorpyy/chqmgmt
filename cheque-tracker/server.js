import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';

import { prisma } from './lib/prisma.js';
import { requireAuth, requireAdmin } from './lib/auth.js';
import { loadCompanyScope, requireCompanyContext } from './lib/companyScope.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import companiesRouter from './routes/companies.js';
import partiesRouter from './routes/parties.js';
import banksRouter from './routes/banks.js';
import staffRouter from './routes/staff.js';
import companyBankAccountsRouter from './routes/companyBankAccounts.js';
import fiscalYearsRouter from './routes/fiscalYears.js';
import chequesRouter from './routes/cheques.js';
import issuedChequesRouter from './routes/issuedCheques.js';
import dashboardRouter from './routes/dashboard.js';
import dailyBalanceRouter from './routes/dailyBalance.js';
import importExportRouter from './routes/importExport.js';
import backupsRouter from './routes/backups.js';
import trashRouter from './routes/trash.js';
import { startBackupScheduler } from './lib/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureDefaultAdmin() {
  // Only acts on a genuinely fresh install — if "admin" already exists,
  // this touches nothing (not even isActive/role), so a password someone
  // already set is never overwritten by a restart.
  const existing = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (existing) return;

  // A random password beats a hardcoded "admin"/"admin" default that every
  // fresh install would otherwise share — printed once, never stored in
  // plaintext or logged again, and mustChangePassword forces it to be
  // replaced before the account can be used for anything.
  const rawPassword = crypto.randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(rawPassword, 10);
  await prisma.user.create({
    data: { username: 'admin', passwordHash, role: 'ADMIN', isActive: true, mustChangePassword: true },
  });
  console.log('============================================================');
  console.log('Initial admin account created.');
  console.log('  username: admin');
  console.log(`  password: ${rawPassword}`);
  console.log('This will not be shown again. You will be required to set a');
  console.log('new password the first time you log in.');
  console.log('============================================================');
}

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not set. Add a long random string to .env.');
}

const app = express();
// Gzip/brotli every response above the default 1KB threshold — JSON API
// responses and the unbundled public/js/*.js files both compress well
// (typically 60-80% smaller), and this is essentially free CPU-wise for an
// app this size.
app.use(compression());
// credentials: true is required for the session cookie to travel with
// fetch() requests made from the frontend (which sets credentials: 'include').
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const PgSession = connectPgSimple(session);
const sessionPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
app.use(session({
  store: new PgSession({ pool: sessionPool, tableName: 'session', createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
}));

// ---- Routes reachable without a logged-in session -------------------------
// Per-IP throttle on login specifically — the account-level lockout in
// routes/auth.js is the real defense (it targets one account regardless of
// which IP is attacking it); this just slows down a script trying many
// different usernames from one source. 20 attempts / 15 min is generous
// enough not to bother anyone fat-fingering their own password.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this address. Try again later.' },
});
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRouter);
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

// ---- Everything below requires a logged-in session ------------------------
app.use('/api', requireAuth);
app.use('/api', loadCompanyScope); // needed by /api/companies itself, so mounted before it

app.use('/api/users', requireAdmin, usersRouter);
app.use('/api/companies', companiesRouter); // no requireCompanyContext — this is how you select one

// ---- Routes scoped to whichever company is currently selected -------------
app.use('/api/parties', requireCompanyContext, partiesRouter);
app.use('/api/banks', requireCompanyContext, banksRouter);
app.use('/api/staff', requireCompanyContext, staffRouter);
app.use('/api/company-bank-accounts', requireCompanyContext, companyBankAccountsRouter);
app.use('/api/fiscal-years', requireCompanyContext, fiscalYearsRouter);
app.use('/api/cheques', requireCompanyContext, chequesRouter);
app.use('/api/issued-cheques', requireCompanyContext, issuedChequesRouter);
app.use('/api/dashboard', requireCompanyContext, dashboardRouter);
app.use('/api/daily-balance', requireCompanyContext, dailyBalanceRouter);
app.use('/api/import-export', requireCompanyContext, importExportRouter);
app.use('/api/trash', requireCompanyContext, trashRouter);
app.use('/api/backups', requireAdmin, backupsRouter);

// ---- Static frontend ------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // Entry points (index.html, login.html) must always be revalidated —
      // they reference the JS/CSS files below by exact filename, so caching
      // them risks serving an old page that points at files a later patch
      // renamed or removed.
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // JS/CSS/etc: cache for a day, still revalidated via ETag after that
      // rather than trusted forever. There's no build step / content-hashed
      // filenames here, so after applying a patch, do one hard refresh
      // (Ctrl+Shift+R) to be safe immediately rather than waiting up to a day.
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Error handling ---------------------------------------------------
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);

  // multer file-size / upload errors carry their own status.
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: `Unique constraint violated on: ${err.meta?.target}` });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({ error: 'Related record not found or referenced elsewhere (foreign key constraint).' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Record not found.' });
    }
  }

  // Postgres CHECK constraint / trigger violations. Prisma Client doesn't
  // always surface the raw SQLSTATE (23514) on err.code for calls that
  // aren't $queryRaw, so also match on the trigger's own RAISE EXCEPTION
  // text and the constraint-name fragments used in manual-migration-additions.sql.
  if (
    err.code === '23514'
    || err.message?.includes('would push total payments')
    || err.message?.includes('violates check constraint')
  ) {
    return res.status(400).json({ error: err.meta?.message || err.message || 'Constraint violation' });
  }

  // Malformed request shape (e.g. an enum-like field that slipped past
  // route-level validation, or a value of the wrong type) — Prisma throws
  // PrismaClientValidationError for these, not PrismaClientKnownRequestError,
  // so without this branch they fell through to a bare 500.
  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({ error: 'Invalid request data.' });
  }

  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

const PORT = process.env.PORT || 3000;
async function startServer() {
  await ensureDefaultAdmin();
  await startBackupScheduler();
  app.listen(PORT, () => {
    console.log(`Cheque tracker running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to initialize the default admin account:', err.message);
  process.exit(1);
});