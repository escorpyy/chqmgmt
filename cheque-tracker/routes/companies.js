import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// GET /api/companies — the companies this user owns, plus which one (or
// 'all') is currently selected in their session.
router.get('/', asyncHandler(async (req, res) => {
  const companies = await prisma.company.findMany({
    where: { createdById: req.session.userId },
    orderBy: { name: 'asc' },
  });
  res.json({ companies, selected: req.session.companyId || null });
}));

// POST /api/companies — create a new company, owned by the current user.
// The first company a user creates is auto-selected.
router.post('/', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  const company = await prisma.company.create({
    data: { name: name.trim(), createdById: req.session.userId },
  });
  req.myCompanyIds.push(company.id);

  if (!req.session.companyId) {
    req.session.companyId = company.id;
  }
  res.status(201).json(company);
}));

// PATCH /api/companies/:id — rename. Only the owning user can rename it.
router.patch('/:id', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (!req.myCompanyIds.includes(req.params.id)) {
    return res.status(404).json({ error: 'Company not found' });
  }
  const company = await prisma.company.update({
    where: { id: req.params.id },
    data: { name: name.trim() },
  });
  res.json(company);
}));

// POST /api/companies/select — { companyId: <id> | 'all' }. Switches which
// slice of data the rest of the session's requests will see.
router.post('/select', asyncHandler(async (req, res) => {
  const { companyId } = req.body;
  if (companyId !== 'all' && !req.myCompanyIds.includes(companyId)) {
    return res.status(400).json({ error: 'companyId must be one of your companies, or "all"' });
  }
  req.session.companyId = companyId;
  res.json({ selected: companyId });
}));

export default router;
