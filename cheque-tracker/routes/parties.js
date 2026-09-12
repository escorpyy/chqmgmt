import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { PARTY_TYPES, isValidEnum } from '../lib/enums.js';
import { companyWhere, requireSingleCompany } from '../lib/companyScope.js';

const router = Router();

// A party can only be linked to a firmId that actually belongs to a FIRM-type
// party in the same company. The DB only guards against a FIRM having a
// firmId and a party being its own firm (see manual-migration-additions.sql
// #4) — it does not check type or company match at all.
async function assertValidFirmId(firmId, companyId) {
  if (!firmId) return null;
  const firm = await prisma.party.findFirst({ where: { id: firmId, companyId, deletedAt: null } });
  if (!firm) return 'firmId does not reference an existing party in this company';
  if (firm.type !== 'FIRM') return 'firmId must reference a party of type FIRM';
  return null;
}

// GET /api/parties?type=FIRM&search=abc&includeDeleted=false
router.get('/', asyncHandler(async (req, res) => {
  const { type, search, includeDeleted } = req.query;

  const where = {
    ...companyWhere(req),
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
  const party = await prisma.party.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
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
  const companyId = requireSingleCompany(req, res);
  if (!companyId) return;
  const { type, name, phone, address, panNo, firmId } = req.body;
  if (!type || !name) {
    return res.status(400).json({ error: 'type and name are required' });
  }
  if (!isValidEnum(type, PARTY_TYPES)) {
    return res.status(400).json({ error: `type must be one of: ${PARTY_TYPES.join(', ')}` });
  }
  if (type === 'INDIVIDUAL' && firmId) {
    const firmError = await assertValidFirmId(firmId, companyId);
    if (firmError) return res.status(400).json({ error: firmError });
  }
  const party = await prisma.party.create({
    data: { type, name, phone, address, panNo, firmId: type === 'FIRM' ? null : (firmId || null), companyId },
  });
  res.status(201).json(party);
}));

// PATCH /api/parties/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.party.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Party not found' });
  const { name, phone, address, panNo, firmId } = req.body;
  if (firmId !== undefined && firmId) {
    if (firmId === req.params.id) {
      return res.status(400).json({ error: 'A party cannot be its own firm' });
    }
    const firmError = await assertValidFirmId(firmId, existing.companyId);
    if (firmError) return res.status(400).json({ error: firmError });
  }
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
  const existing = await prisma.party.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Party not found' });
  const party = await prisma.party.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json(party);
}));

// POST /api/parties/:id/restore
router.post('/:id/restore', asyncHandler(async (req, res) => {
  const existing = await prisma.party.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Party not found' });
  const party = await prisma.party.update({
    where: { id: req.params.id },
    data: { deletedAt: null },
  });
  res.json(party);
}));

export default router;