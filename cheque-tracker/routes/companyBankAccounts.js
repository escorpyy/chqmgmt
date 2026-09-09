import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { companyWhere, requireSingleCompany } from '../lib/companyScope.js';

const router = Router();

async function assertBankInCompany(bankId, companyId) {
  const bank = await prisma.bank.findFirst({ where: { id: bankId, companyId } });
  return !!bank;
}

router.get('/', asyncHandler(async (req, res) => {
  const accounts = await prisma.companyBankAccount.findMany({
    where: companyWhere(req),
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
  const existing = await prisma.companyBankAccount.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
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

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.companyBankAccount.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Company bank account not found' });
  await prisma.companyBankAccount.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
