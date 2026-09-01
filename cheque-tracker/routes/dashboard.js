import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/summary', asyncHandler(async (req, res) => {
  const [receivedByStatus, issuedByStatus, receivedTotals, issuedTotals] = await Promise.all([
    prisma.cheque.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.issuedCheque.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.cheque.aggregate({
      where: { deletedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.issuedCheque.aggregate({
      where: { deletedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  const onCheck = await Promise.all([
    prisma.chequeCheckLog.count({ where: { resolvedAt: null } }),
    prisma.issuedChequeCheckLog.count({ where: { resolvedAt: null } }),
  ]);

  res.json({
    received: {
      total: receivedTotals._count._all,
      totalAmount: receivedTotals._sum.amount || 0,
      byStatus: receivedByStatus.map((s) => ({
        status: s.status, count: s._count._all, amount: s._sum.amount || 0,
      })),
    },
    issued: {
      total: issuedTotals._count._all,
      totalAmount: issuedTotals._sum.amount || 0,
      byStatus: issuedByStatus.map((s) => ({
        status: s.status, count: s._count._all, amount: s._sum.amount || 0,
      })),
    },
    openInvestigations: {
      received: onCheck[0],
      issued: onCheck[1],
    },
  });
}));

export default router;
