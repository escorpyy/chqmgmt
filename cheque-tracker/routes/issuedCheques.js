import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { computeTotalDays, deriveChequeType } from '../lib/chequeHelpers.js';

const router = Router();

const issuedInclude = {
  companyBankAccount: { include: { bank: true } },
  payee: true,
  issuedBy: true,
  followUps: { orderBy: { followUpDate: 'desc' } },
  payments: { orderBy: { paymentDate: 'desc' } },
  checkLogs: { orderBy: { raisedAt: 'desc' } },
  replaces: true,
  replacedBy: true,
};

router.get('/', asyncHandler(async (req, res) => {
  const { status, search, includeDeleted } = req.query;
  const where = {
    ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { chqNo: { contains: search, mode: 'insensitive' } },
            { payeeName: { contains: search, mode: 'insensitive' } },
            { purpose: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const cheques = await prisma.issuedCheque.findMany({
    where,
    include: { companyBankAccount: { include: { bank: true } }, payee: true, issuedBy: true },
    orderBy: { chqDate: 'desc' },
  });
  res.json(cheques);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const cheque = await prisma.issuedCheque.findUnique({
    where: { id: req.params.id },
    include: issuedInclude,
  });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });
  res.json(cheque);
}));

router.post('/', asyncHandler(async (req, res) => {
  const {
    companyBankAccountId, chqNo, chqDate, payeeId, payeeName, payeeType,
    amount, purpose, issuedById,
  } = req.body;

  const required = { companyBankAccountId, chqNo, chqDate, payeeName, payeeType, amount };
  const missing = Object.entries(required).filter(([, v]) => v === undefined || v === null || v === '');
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.map(([k]) => k).join(', ')}` });
  }

  const cheque = await prisma.issuedCheque.create({
    data: {
      companyBankAccountId,
      chqNo,
      chqDate: new Date(chqDate),
      payeeId: payeeId || null,
      payeeName,
      payeeType,
      chequeType: deriveChequeType(payeeType),
      amount,
      purpose,
      issuedById: issuedById || null,
    },
    include: issuedInclude,
  });
  res.status(201).json(cheque);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { purpose, issuedById, amount } = req.body;
  const cheque = await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: {
      ...(purpose !== undefined ? { purpose } : {}),
      ...(issuedById !== undefined ? { issuedById: issuedById || null } : {}),
      ...(amount !== undefined ? { amount } : {}),
    },
    include: issuedInclude,
  });
  res.json(cheque);
}));

// PATCH /api/issued-cheques/:id/status
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status, clearanceMethod, returnReason, returnNote, statusDate } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const existing = await prisma.issuedCheque.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Issued cheque not found' });

  const newStatusDate = statusDate ? new Date(statusDate) : new Date();
  const totalDays = computeTotalDays(existing.chqDate, newStatusDate);

  const cheque = await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: {
      status,
      statusDate: newStatusDate,
      totalDays,
      previousStatus: status === 'ON_CHECK' ? existing.status : existing.previousStatus,
      ...(status === 'CLEARED' ? { clearanceMethod: clearanceMethod || 'PRESENTMENT' } : {}),
      ...(status === 'RETURNED' ? { returnReason: returnReason || null, returnNote: returnNote || null } : {}),
    },
    include: issuedInclude,
  });
  res.json(cheque);
}));

// POST /api/issued-cheques/:id/replace
router.post('/:id/replace', asyncHandler(async (req, res) => {
  const original = await prisma.issuedCheque.findUnique({ where: { id: req.params.id } });
  if (!original) return res.status(404).json({ error: 'Original issued cheque not found' });

  const { chqDate, chqNo, companyBankAccountId, amount, issuedById } = req.body;

  const replacement = await prisma.issuedCheque.create({
    data: {
      companyBankAccountId: companyBankAccountId ?? original.companyBankAccountId,
      chqNo,
      chqDate: new Date(chqDate),
      payeeId: original.payeeId,
      payeeName: original.payeeName,
      payeeType: original.payeeType,
      chequeType: original.chequeType,
      amount: amount ?? original.amount,
      purpose: original.purpose,
      issuedById: issuedById ?? original.issuedById,
      replacesChequeId: original.id,
    },
    include: issuedInclude,
  });
  res.status(201).json(replacement);
}));

router.post('/:id/followups', asyncHandler(async (req, res) => {
  const { response, note, nextActionDate, staffId, followUpDate, updateStatus } = req.body;
  if (!response) return res.status(400).json({ error: 'response is required' });

  const cheque = await prisma.issuedCheque.findUnique({ where: { id: req.params.id } });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });

  const followUp = await prisma.issuedChequeFollowUp.create({
    data: {
      issuedChequeId: req.params.id,
      response,
      note,
      nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
      staffId: staffId || null,
      followUpDate: followUpDate ? new Date(followUpDate) : undefined,
    },
  });

  if (updateStatus !== false && cheque.status === 'RETURNED') {
    const newStatusDate = new Date();
    await prisma.issuedCheque.update({
      where: { id: req.params.id },
      data: {
        status: 'FOLLOWUP',
        statusDate: newStatusDate,
        totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
      },
    });
  }

  res.status(201).json(followUp);
}));

router.post('/:id/payments', asyncHandler(async (req, res) => {
  const { amount, method, referenceNo, note, paymentDate, staffId } = req.body;
  if (!amount || !method) return res.status(400).json({ error: 'amount and method are required' });

  const cheque = await prisma.issuedCheque.findUnique({
    where: { id: req.params.id },
    include: { payments: true },
  });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });

  const alreadyPaid = cheque.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  if (alreadyPaid + Number(amount) > Number(cheque.amount)) {
    return res.status(400).json({
      error: `Payment of ${amount} would push total payments (${alreadyPaid + Number(amount)}) beyond the cheque amount (${cheque.amount})`,
    });
  }

  const payment = await prisma.issuedChequePayment.create({
    data: {
      issuedChequeId: req.params.id,
      amount,
      method,
      referenceNo,
      note,
      paymentDate: paymentDate ? new Date(paymentDate) : undefined,
      staffId: staffId || null,
    },
  });

  const newTotal = alreadyPaid + Number(amount);
  if (newTotal >= Number(cheque.amount)) {
    const newStatusDate = new Date();
    await prisma.issuedCheque.update({
      where: { id: req.params.id },
      data: {
        status: 'CLEARED',
        clearanceMethod: 'PARTIAL_RECOVERY',
        statusDate: newStatusDate,
        totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
      },
    });
  }

  res.status(201).json(payment);
}));

router.post('/:id/checklogs', asyncHandler(async (req, res) => {
  const { reason, raisedById } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const cheque = await prisma.issuedCheque.findUnique({ where: { id: req.params.id } });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });

  const checkLog = await prisma.issuedChequeCheckLog.create({
    data: { issuedChequeId: req.params.id, reason, raisedById: raisedById || null },
  });

  const newStatusDate = new Date();
  await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: {
      status: 'ON_CHECK',
      previousStatus: cheque.status,
      statusDate: newStatusDate,
      totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
    },
  });

  res.status(201).json(checkLog);
}));

router.patch('/:id/checklogs/:checkLogId/resolve', asyncHandler(async (req, res) => {
  const { resolvedStatus, resolutionNote } = req.body;
  if (!resolvedStatus) return res.status(400).json({ error: 'resolvedStatus is required' });

  const cheque = await prisma.issuedCheque.findUnique({ where: { id: req.params.id } });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });

  const checkLog = await prisma.issuedChequeCheckLog.update({
    where: { id: req.params.checkLogId },
    data: { resolvedAt: new Date(), resolvedStatus, resolutionNote },
  });

  const newStatusDate = new Date();
  await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: {
      status: resolvedStatus,
      previousStatus: null,
      statusDate: newStatusDate,
      totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
    },
  });

  res.json(checkLog);
}));

// DELETE /api/issued-cheques/:id  (soft delete)
router.delete('/:id', asyncHandler(async (req, res) => {
  const cheque = await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json(cheque);
}));

export default router;
