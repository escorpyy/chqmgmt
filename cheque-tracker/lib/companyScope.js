import { prisma } from './prisma.js';

// Runs after requireAuth. Loads which companies the current user owns
// (companies are owned 1:1 by their creator — no cross-user sharing yet)
// so every request downstream can answer "what am I allowed to see" without
// re-querying it repeatedly.
export async function loadCompanyScope(req, res, next) {
  const companies = await prisma.company.findMany({
    where: { createdById: req.session.userId },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  req.myCompanyIds = companies.map((c) => c.id);
  next();
}

// Guards routes that need a company selected in session (set via
// POST /api/companies/select). 'all' is a valid, explicit selection —
// distinct from nothing having been selected yet.
export function requireCompanyContext(req, res, next) {
  const selected = req.session.companyId;
  if (!selected) {
    return res.status(409).json({ error: 'No company selected', code: 'NO_COMPANY_SELECTED' });
  }
  if (selected !== 'all' && !req.myCompanyIds.includes(selected)) {
    // Session points at a company that's since been deleted/reassigned, or
    // never belonged to this user — don't silently leak or 500, make them
    // reselect.
    return res.status(409).json({ error: 'Selected company is no longer available', code: 'NO_COMPANY_SELECTED' });
  }
  next();
}

// For read paths: a Prisma `where` fragment scoping to the current
// selection — a single company, or every company this user owns when
// 'all' is selected (never every company in the whole database).
export function companyWhere(req) {
  if (req.session.companyId === 'all') {
    return { companyId: { in: req.myCompanyIds } };
  }
  return { companyId: req.session.companyId };
}

// For write paths: creating/editing a record only makes sense under one
// concrete company. Returns the companyId, or sends a 400 and returns null
// (caller should just `return` when this happens).
export function requireSingleCompany(req, res) {
  const selected = req.session.companyId;
  if (!selected || selected === 'all') {
    res.status(400).json({ error: 'Select a specific company before creating or editing records' });
    return null;
  }
  return selected;
}
