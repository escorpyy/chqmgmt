import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const staff = await prisma.staff.findMany({ orderBy: { name: 'asc' } });
  res.json(staff);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const staff = await prisma.staff.create({ data: { name, phone } });
  res.status(201).json(staff);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
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
  await prisma.staff.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
