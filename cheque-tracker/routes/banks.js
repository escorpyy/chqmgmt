import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const banks = await prisma.bank.findMany({
    include: { _count: { select: { draweeCheques: true, presentedCheques: true, companyAccounts: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(banks);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const bank = await prisma.bank.findUnique({
    where: { id: req.params.id },
    include: { companyAccounts: true },
  });
  if (!bank) return res.status(404).json({ error: 'Bank not found' });
  res.json(bank);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, branch } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const bank = await prisma.bank.create({ data: { name, branch } });
  res.status(201).json(bank);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { name, branch } = req.body;
  const bank = await prisma.bank.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(branch !== undefined ? { branch } : {}),
    },
  });
  res.json(bank);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.bank.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
