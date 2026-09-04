import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const fiscalYears = await prisma.fiscalYear.findMany({
    include: { _count: { select: { cheques: true } } },
    orderBy: { year: 'desc' },
  });
  res.json(fiscalYears);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const fiscalYear = await prisma.fiscalYear.findUnique({
    where: { id: req.params.id },
    include: { cheques: { include: { issuer: true, bank: true } } },
  });
  if (!fiscalYear) return res.status(404).json({ error: 'Fiscal year not found' });
  res.json(fiscalYear);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { year } = req.body;
  if (!year || !year.trim()) return res.status(400).json({ error: 'year is required' });
  const fiscalYear = await prisma.fiscalYear.create({ data: { year: year.trim() } });
  res.status(201).json(fiscalYear);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { year } = req.body;
  if (year !== undefined && !year.trim()) {
    return res.status(400).json({ error: 'year cannot be blank' });
  }
  const fiscalYear = await prisma.fiscalYear.update({
    where: { id: req.params.id },
    data: { ...(year !== undefined ? { year: year.trim() } : {}) },
  });
  res.json(fiscalYear);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.fiscalYear.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
