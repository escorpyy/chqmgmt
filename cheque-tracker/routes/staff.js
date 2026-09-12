import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { companyWhere, requireSingleCompany } from '../lib/companyScope.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const staff = await prisma.staff.findMany({ where: companyWhere(req), orderBy: { name: 'asc' } });
  res.json(staff);
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = requireSingleCompany(req, res);
  if (!companyId) return;
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const staff = await prisma.staff.create({ data: { name, phone, companyId } });
  res.status(201).json(staff);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.staff.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Staff not found' });
  const { name, phone } = req.body;
  const staff = await prisma.staff.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(phone !== undefined ? { phone } : {}),
    },
  });
  res.json(staff);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.staff.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Staff not found' });
  await prisma.staff.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;