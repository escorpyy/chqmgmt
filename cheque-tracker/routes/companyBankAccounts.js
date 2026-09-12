import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { companyWhere, requireSingleCompany } from '../lib/companyScope.js';

const router = Router();

// A deleted bank shouldn't be attachable to a new (or re-pointed) account.
async function assertBankInCompany(bankId, companyId) {
  const bank = await prisma.bank.findFirst({ where: { id: bankId, companyId, deletedAt: null } });
  return !!bank;
}

// GET /api/company-bank-accounts?includeDeleted=true
router.get('/', asyncHandler(async (req, res) => {
  const { includeDeleted } = req.query;
  const accounts = await prisma.companyBankAccount.findMany({
    where: {
      ...companyWhere(req),
      ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
    },
    include: { bank: true, _count: { select: { issuedCheques: true } } },
    orderBy: { accountName: 'asc' },
  });
  res.json(accounts);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const account = await prisma.companyBankAccount.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: { bank: true, _count: { select: { issuedCheques: true } } },
  });
  if (!account) return res.status(404).json({ error: 'Company bank account not found' });
  res.json(account);
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = requireSingleCompany(req, res);
  if (!companyId) return;
  const { bankId, accountName, accountNumber, branch } = req.body;
  if (!bankId || !accountName || !accountNumber) {
    return res.status(400).json({ error: 'bankId, accountName and accountNumber are required' });
  }
  if (!(await assertBankInCompany(bankId, companyId))) {
    return res.status(400).json({ error: 'bankId does not reference a bank in the selected company' });
  }
  const account = await prisma.companyBankAccount.create({
    data: { bankId, accountName, accountNumber, branch, companyId },
  });
  res.status(201).json(account);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.companyBankAccount.findFirst({ where: { id: req.params.id, deletedAt: null, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Company bank account not found' });
  const { accountName, accountNumber, branch, bankId } = req.body;
  if (bankId !== undefined && !(await assertBankInCompany(bankId, existing.companyId))) {
    return res.status(400).json({ error: 'bankId does not reference a bank in this account\'s company' });
  }
  const account = await prisma.companyBankAccount.update({
    where: { id: req.params.id },
    data: {
      ...(accountName !== undefined ? { accountName } : {}),
      ...(accountNumber !== undefined ? { accountNumber } : {}),
      ...(branch !== undefined ? { branch } : {}),
      ...(bankId !== undefined ? { bankId } : {}),
    },
  });
  res.json(account);
}));

// DELETE /api/company-bank-accounts/:id  (soft delete — an account used on old issued cheques must never be hard-deleted)
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.companyBankAccount.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Company bank account not found' });
  const account = await prisma.companyBankAccount.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json(account);
}));

// POST /api/company-bank-accounts/:id/restore
router.post('/:id/restore', asyncHandler(async (req, res) => {
  const existing = await prisma.companyBankAccount.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Company bank account not found' });
  const account = await prisma.companyBankAccount.update({
    where: { id: req.params.id },
    data: { deletedAt: null },
  });
  res.json(account);
}));

export default router;
