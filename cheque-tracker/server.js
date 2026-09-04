import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';

import { prisma } from './lib/prisma.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// ---- API routes ----------------------------------------------------------
app.use('/api/parties', partiesRouter);
app.use('/api/banks', banksRouter);
app.use('/api/staff', staffRouter);
app.use('/api/company-bank-accounts', companyBankAccountsRouter);
app.use('/api/fiscal-years', fiscalYearsRouter);
app.use('/api/cheques', chequesRouter);
app.use('/api/issued-cheques', issuedChequesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/daily-balance', dailyBalanceRouter);
app.use('/api/import-export', importExportRouter);

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

// ---- Static frontend ------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
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
app.listen(PORT, () => {
  console.log(`Cheque tracker running at http://localhost:${PORT}`);
});
