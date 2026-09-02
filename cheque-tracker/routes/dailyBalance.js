import { Router } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// A date-only string like "2026-09-02" -> a UTC-midnight Date, matching how
// Prisma stores @db.Date columns and how we want to bound chqDate <= that day.
function parseDateParam(raw) {
  const str = (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) ? raw : new Date().toISOString().slice(0, 10);
  return new Date(`${str}T00:00:00.000Z`);
}

function endOfDay(date) {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
}

// Builds the full per-account balance picture for one day:
//   opening balance + received today (both manual, from DailyBankBalance)
//   minus cheques due (computed live from IssuedCheque, not stored)
async function computeBalances(date) {
  const cutoff = endOfDay(date);

  const [accounts, entries, dueByAccount] = await Promise.all([
    prisma.companyBankAccount.findMany({
      include: { bank: true },
      orderBy: { accountName: 'asc' },
    }),
    prisma.dailyBankBalance.findMany({ where: { date } }),
    // "Due" = every still-outstanding issued cheque with chqDate on or
    // before this day, however old, as long as it hasn't been cancelled,
    // cleared, returned, or stopped — those no longer threaten the balance.
    prisma.issuedCheque.groupBy({
      by: ['companyBankAccountId'],
      where: { chqDate: { lte: cutoff }, status: 'ISSUED', deletedAt: null },
      _sum: { amount: true },
    }),
  ]);

  const entryByAccount = new Map(entries.map((e) => [e.companyBankAccountId, e]));
  const dueMap = new Map(dueByAccount.map((d) => [d.companyBankAccountId, Number(d._sum.amount || 0)]));

  const rows = accounts.map((account) => {
    const entry = entryByAccount.get(account.id) || null;
    const openingBalance = entry ? Number(entry.openingBalance) : null;
    const receivedToday = entry ? Number(entry.receivedToday) : 0;
    const chequesDue = dueMap.get(account.id) || 0;
    const available = openingBalance === null ? null : (openingBalance - chequesDue + receivedToday);

    return {
      companyBankAccountId: account.id,
      accountName: account.accountName,
      accountNumber: account.accountNumber,
      bankName: account.bank?.name || '—',
      openingBalanceSet: openingBalance !== null,
      openingBalance: openingBalance || 0,
      receivedToday,
      chequesDue,
      available,
    };
  });

  const totals = rows.reduce((acc, r) => ({
    openingBalance: acc.openingBalance + (r.openingBalanceSet ? r.openingBalance : 0),
    receivedToday: acc.receivedToday + r.receivedToday,
    chequesDue: acc.chequesDue + r.chequesDue,
    available: acc.available + (r.available === null ? 0 : r.available),
    allSet: acc.allSet && r.openingBalanceSet,
  }), { openingBalance: 0, receivedToday: 0, chequesDue: 0, available: 0, allSet: rows.length > 0 });

  return { date: date.toISOString().slice(0, 10), rows, totals };
}

router.get('/', asyncHandler(async (req, res) => {
  const date = parseDateParam(req.query.date);
  res.json(await computeBalances(date));
}));

// Upsert the morning's manual entry (opening balance / received today) for
// one account on one date. Either field may be sent alone.
router.put('/:companyBankAccountId', asyncHandler(async (req, res) => {
  const { companyBankAccountId } = req.params;
  const date = parseDateParam(req.body.date);
  const { openingBalance, receivedToday } = req.body;

  if (openingBalance === undefined && receivedToday === undefined) {
    return res.status(400).json({ error: 'openingBalance and/or receivedToday is required' });
  }

  const existing = await prisma.dailyBankBalance.findUnique({
    where: { companyBankAccountId_date: { companyBankAccountId, date } },
  });

  const entry = await prisma.dailyBankBalance.upsert({
    where: { companyBankAccountId_date: { companyBankAccountId, date } },
    create: {
      companyBankAccountId,
      date,
      openingBalance: openingBalance ?? 0,
      receivedToday: receivedToday ?? 0,
    },
    update: {
      ...(openingBalance !== undefined ? { openingBalance } : {}),
      ...(receivedToday !== undefined ? { receivedToday } : {}),
    },
  });

  res.status(existing ? 200 : 201).json(entry);
}));

router.get('/export', asyncHandler(async (req, res) => {
  const date = parseDateParam(req.query.date);
  const { rows, totals } = await computeBalances(date);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Daily Balance');

  sheet.columns = [
    { header: 'Bank Account', key: 'accountName', width: 28 },
    { header: 'Bank', key: 'bankName', width: 20 },
    { header: 'Account No.', key: 'accountNumber', width: 18 },
    { header: 'Opening Balance', key: 'openingBalance', width: 18 },
    { header: 'Cheques Due', key: 'chequesDue', width: 18 },
    { header: 'Received Today', key: 'receivedToday', width: 18 },
    { header: 'Available Balance', key: 'available', width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const r of rows) {
    sheet.addRow({
      accountName: r.accountName,
      bankName: r.bankName,
      accountNumber: r.accountNumber,
      openingBalance: r.openingBalanceSet ? r.openingBalance : null,
      chequesDue: r.chequesDue,
      receivedToday: r.receivedToday,
      available: r.available,
    });
  }

  const totalRow = sheet.addRow({
    accountName: 'TOTAL',
    openingBalance: totals.openingBalance,
    chequesDue: totals.chequesDue,
    receivedToday: totals.receivedToday,
    available: totals.available,
  });
  totalRow.font = { bold: true };

  ['openingBalance', 'chequesDue', 'receivedToday', 'available'].forEach((key) => {
    sheet.getColumn(key).numFmt = '#,##0.00;(#,##0.00)';
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-balance-${rows.length ? date.toISOString().slice(0, 10) : 'export'}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}));

export default router;
