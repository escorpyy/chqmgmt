import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const accounts = await prisma.companyBankAccount.findMany({
    include: { bank: true, _count: { select: { issuedCheques: true } } },
    orderBy: { accountName: 'asc' },
  });
  res.json(accounts);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const account = await prisma.companyBankAccount.findUnique({
    where: { id: req.params.id },
    include: { bank: true, _count: { select: { issuedCheques: true } } },
  });
  if (!account) return res.status(404).json({ error: 'Company bank account not found' });
  res.json(account);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { bankId, accountName, accountNumber, branch } = req.body;
  if (!bankId || !accountName || !accountNumber) {
    return res.status(400).json({ error: 'bankId, accountName and accountNumber are required' });
  }
  const account = await prisma.companyBankAccount.create({
    data: { bankId, accountName, accountNumber, branch },
  });
  res.status(201).json(account);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { accountName, accountNumber, branch, bankId } = req.body;
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
  await prisma.companyBankAccount.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
