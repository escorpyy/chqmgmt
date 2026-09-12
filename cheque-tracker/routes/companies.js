import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAdmin } from '../lib/auth.js';

const router = Router();

// GET /api/companies — every company this user can access: ones they
// created (isOwner: true) plus ones an admin granted them via
// CompanyMember (isOwner: false) — plus which one (or 'all') is currently
// selected in their session.
router.get('/', asyncHandler(async (req, res) => {
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { createdById: req.session.userId },
        { members: { some: { userId: req.session.userId } } },
      ],
    },
    orderBy: { name: 'asc' },
  });
  const withOwnership = companies.map((c) => ({ ...c, isOwner: c.createdById === req.session.userId }));
  res.json({ companies: withOwnership, selected: req.session.companyId || null });
}));

// GET /api/companies/all — every company in the system, with owner and
// member info. Admin-only: this is the "who can see what" management view,
// not a data-access route, so it deliberately ignores the requester's own
// company scope.
router.get('/all', requireAdmin, asyncHandler(async (req, res) => {
  const companies = await prisma.company.findMany({
    include: {
      createdBy: { select: { id: true, username: true } },
      members: { include: { user: { select: { id: true, username: true, isActive: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  res.json(companies.map((c) => ({
    id: c.id,
    name: c.name,
    owner: c.createdBy,
    members: c.members.map((m) => m.user),
  })));
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

// PATCH /api/companies/:id — rename. Only the owning (creating) user can
// rename it — being a member (granted access) isn't enough, so this checks
// createdById directly rather than req.myCompanyIds (which includes both).
router.patch('/:id', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const existing = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.createdById !== req.session.userId) {
    return res.status(404).json({ error: 'Company not found' });
  }
  const company = await prisma.company.update({
    where: { id: req.params.id },
    data: { name: name.trim() },
  });
  res.json(company);
}));

// POST /api/companies/:id/members — grant a user access to this company.
// Admin-only: membership is an access-control decision, same bucket as
// creating/editing users.
router.post('/:id/members', requireAdmin, asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) return res.status(404).json({ error: 'Company not found' });
  if (company.createdById === userId) {
    return res.status(400).json({ error: 'This user already owns the company' });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: req.params.id, userId } },
    update: {},
    create: { companyId: req.params.id, userId },
  });
  res.status(201).json({ ok: true });
}));

// DELETE /api/companies/:id/members/:userId — revoke a user's access.
router.delete('/:id/members/:userId', requireAdmin, asyncHandler(async (req, res) => {
  await prisma.companyMember.deleteMany({
    where: { companyId: req.params.id, userId: req.params.userId },
  });
  res.status(204).end();
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