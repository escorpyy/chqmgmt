import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAdmin } from '../lib/auth.js';
import { companyWhere } from '../lib/companyScope.js';

const router = Router();

// Every soft-deletable model, how to fetch its deleted rows scoped to the
// current company selection, and how to label a row for display in Trash.
// Adding a new soft-deletable model in the future just means adding an
// entry here — the routes below are all generic over this table.
const KINDS = {
  party: {
    model: 'party',
    label: 'Party',
    async find(where) {
      return prisma.party.findMany({ where, orderBy: { deletedAt: 'desc' } });
    },
    describe: (r) => r.name,
  },
  bank: {
    model: 'bank',
    label: 'Bank',
    async find(where) {
      return prisma.bank.findMany({ where, orderBy: { deletedAt: 'desc' } });
    },
    describe: (r) => r.name,
  },
  staff: {
    model: 'staff',
    label: 'Staff',
    async find(where) {
      return prisma.staff.findMany({ where, orderBy: { deletedAt: 'desc' } });
    },
    describe: (r) => r.name,
  },
  companyBankAccount: {
    model: 'companyBankAccount',
    label: 'Company bank account',
    async find(where) {
      return prisma.companyBankAccount.findMany({ where, include: { bank: true }, orderBy: { deletedAt: 'desc' } });
    },
    describe: (r) => `${r.accountName} · ${r.accountNumber}${r.bank ? ` (${r.bank.name})` : ''}`,
  },
  cheque: {
    model: 'cheque',
    label: 'Received cheque',
    async find(where) {
      return prisma.cheque.findMany({ where, include: { issuer: true }, orderBy: { deletedAt: 'desc' } });
    },
    describe: (r) => `#${r.chqNo} · ${r.issuer?.name || '—'} · ${r.amount}`,
  },
  issuedCheque: {
    model: 'issuedCheque',
    label: 'Issued cheque',
    async find(where) {
      return prisma.issuedCheque.findMany({ where, include: { payee: true }, orderBy: { deletedAt: 'desc' } });
    },
    describe: (r) => `#${r.chqNo} · ${r.payee?.name || '—'} · ${r.amount}`,
  },
};

// GET /api/trash — every soft-deleted record across all kinds, scoped to
// the current company selection, newest-deleted first.
router.get('/', asyncHandler(async (req, res) => {
  const where = { ...companyWhere(req), deletedAt: { not: null } };
  const results = await Promise.all(
    Object.entries(KINDS).map(async ([kind, def]) => {
      const rows = await def.find(where);
      return rows.map((r) => ({
        kind,
        kindLabel: def.label,
        id: r.id,
        label: def.describe(r),
        deletedAt: r.deletedAt,
      }));
    }),
  );
  const flattened = results.flat().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  res.json(flattened);
}));

// POST /api/trash/:kind/:id/restore
router.post('/:kind/:id/restore', asyncHandler(async (req, res) => {
  const def = KINDS[req.params.kind];
  if (!def) return res.status(400).json({ error: 'Unknown trash item kind' });
  const existing = await prisma[def.model].findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  const restored = await prisma[def.model].update({ where: { id: req.params.id }, data: { deletedAt: null } });
  res.json(restored);
}));

// DELETE /api/trash/:kind/:id — permanently and irreversibly remove a
// soft-deleted record. Admin-only, and additionally requires the admin to
// re-enter their own password in the request body — this is the
// destructive action Trash exists to guard against happening by accident.
router.delete('/:kind/:id', requireAdmin, asyncHandler(async (req, res) => {
  const def = KINDS[req.params.kind];
  if (!def) return res.status(400).json({ error: 'Unknown trash item kind' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required to permanently delete' });
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  const ok = user && await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(403).json({ error: 'Incorrect password' });

  const existing = await prisma[def.model].findFirst({ where: { id: req.params.id, ...companyWhere(req), deletedAt: { not: null } } });
  if (!existing) return res.status(404).json({ error: 'Item not found, or not in Trash' });

  // If this record is still referenced elsewhere (e.g. a bank still on
  // some cheque somewhere), Prisma's onDelete: Restrict rejects the delete
  // and the shared error handler turns that into a clear 409 rather than a
  // raw 500 — nothing special needed here for that case.
  await prisma[def.model].delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
