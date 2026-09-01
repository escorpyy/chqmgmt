import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// GET /api/parties?type=FIRM&search=abc&includeDeleted=false
router.get('/', asyncHandler(async (req, res) => {
  const { type, search, includeDeleted } = req.query;

  const where = {
    ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
    ...(type ? { type } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  };

  const parties = await prisma.party.findMany({
    where,
    include: { firm: true, _count: { select: { members: true, cheques: true, paidCheques: true } } },
    orderBy: { name: 'asc' },
  });

  res.json(parties);
}));

// GET /api/parties/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const party = await prisma.party.findUnique({
    where: { id: req.params.id },
    include: {
      firm: true,
      members: true,
      cheques: { orderBy: { chqDate: 'desc' }, take: 25 },
      paidCheques: { orderBy: { chqDate: 'desc' }, take: 25 },
    },
  });
  if (!party) return res.status(404).json({ error: 'Party not found' });
  res.json(party);
}));

// POST /api/parties
router.post('/', asyncHandler(async (req, res) => {
  const { type, name, phone, address, panNo, firmId } = req.body;
  if (!type || !name) {
    return res.status(400).json({ error: 'type and name are required' });
  }
  const party = await prisma.party.create({
    data: { type, name, phone, address, panNo, firmId: firmId || null },
  });
  res.status(201).json(party);
}));

// PATCH /api/parties/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const { name, phone, address, panNo, firmId } = req.body;
  const party = await prisma.party.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(panNo !== undefined ? { panNo } : {}),
      ...(firmId !== undefined ? { firmId: firmId || null } : {}),
    },
  });
  res.json(party);
}));

// DELETE /api/parties/:id  (soft delete — financial history must never be hard-deleted)
router.delete('/:id', asyncHandler(async (req, res) => {
  const party = await prisma.party.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json(party);
}));

// POST /api/parties/:id/restore
router.post('/:id/restore', asyncHandler(async (req, res) => {
  const party = await prisma.party.update({
    where: { id: req.params.id },
    data: { deletedAt: null },
  });
  res.json(party);
}));

export default router;
