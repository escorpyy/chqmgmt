import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { companyWhere, requireSingleCompany } from '../lib/companyScope.js';

const router = Router();

// GET /api/banks?includeDeleted=true
router.get('/', asyncHandler(async (req, res) => {
  const { includeDeleted } = req.query;
  const banks = await prisma.bank.findMany({
    where: {
      ...companyWhere(req),
      ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
    },
    include: { _count: { select: { draweeCheques: true, presentedCheques: true, companyAccounts: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(banks);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const bank = await prisma.bank.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: { companyAccounts: true },
  });
  if (!bank) return res.status(404).json({ error: 'Bank not found' });
  res.json(bank);
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = requireSingleCompany(req, res);
  if (!companyId) return;
  const { name, branch } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const bank = await prisma.bank.create({ data: { name: name.trim(), branch, companyId } });
  res.status(201).json(bank);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.bank.findFirst({ where: { id: req.params.id, deletedAt: null, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Bank not found' });
  const { name, branch } = req.body;
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'name cannot be blank' });
  }
  const bank = await prisma.bank.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(branch !== undefined ? { branch } : {}),
    },
  });
  res.json(bank);
}));

// DELETE /api/banks/:id  (soft delete — a bank used on old cheques must never be hard-deleted)
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.bank.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Bank not found' });
  const bank = await prisma.bank.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json(bank);
}));

// POST /api/banks/:id/restore
router.post('/:id/restore', asyncHandler(async (req, res) => {
  const existing = await prisma.bank.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Bank not found' });
  const bank = await prisma.bank.update({
    where: { id: req.params.id },
    data: { deletedAt: null },
  });
  res.json(bank);
}));

export default router;
