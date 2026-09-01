import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { computeTotalDays, deriveChequeType } from '../lib/chequeHelpers.js';

const router = Router();

const chequeInclude = {
  receipt: true,
  issuer: true,
  bank: true,
  presentedBank: true,
  staff: true,
  followUps: { orderBy: { followUpDate: 'desc' } },
  payments: { orderBy: { paymentDate: 'desc' } },
  checkLogs: { orderBy: { raisedAt: 'desc' } },
  replaces: true,
  replacedBy: true,
};

// GET /api/cheques?status=PENDING&search=abc
router.get('/', asyncHandler(async (req, res) => {
  const { status, search, includeDeleted } = req.query;
  const where = {
    ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { chqNo: { contains: search, mode: 'insensitive' } },
            { refNo: { contains: search, mode: 'insensitive' } },
            { issuedOn: { contains: search, mode: 'insensitive' } },
            { issuer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const cheques = await prisma.cheque.findMany({
    where,
    include: { receipt: true, issuer: true, bank: true, presentedBank: true, staff: true },
    orderBy: { chqDate: 'desc' },
  });
  res.json(cheques);
}));

// GET /api/cheques/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const cheque = await prisma.cheque.findUnique({
    where: { id: req.params.id },
    include: chequeInclude,
  });
  if (!cheque) return res.status(404).json({ error: 'Cheque not found' });
  res.json(cheque);
}));

// POST /api/cheques
router.post('/', asyncHandler(async (req, res) => {
  const {
    receiptId, refNo, issuerId, issuedOn, issuedOnType, payableToCompany,
    chqDate, chqNo, bankId, presentedBankId, amount, staffId,
  } = req.body;

  const required = { receiptId, issuerId, issuedOn, issuedOnType, chqDate, chqNo, bankId, amount };
  const missing = Object.entries(required).filter(([, v]) => v === undefined || v === null || v === '');
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.map(([k]) => k).join(', ')}` });
  }

  const cheque = await prisma.cheque.create({
    data: {
      receiptId,
      refNo,
      issuerId,
      issuedOn,
      issuedOnType,
      chequeType: deriveChequeType(issuedOnType),
      payableToCompany: payableToCompany ?? true,
      chqDate: new Date(chqDate),
      chqNo,
      bankId,
      presentedBankId: presentedBankId || null,
      amount,
      staffId: staffId || null,
    },
    include: chequeInclude,
  });
  res.status(201).json(cheque);
}));

// PATCH /api/cheques/:id  (edit non-status fields)
router.patch('/:id', asyncHandler(async (req, res) => {
  const { refNo, presentedBankId, staffId, amount } = req.body;
  const cheque = await prisma.cheque.update({
    where: { id: req.params.id },
    data: {
      ...(refNo !== undefined ? { refNo } : {}),
      ...(presentedBankId !== undefined ? { presentedBankId: presentedBankId || null } : {}),
      ...(staffId !== undefined ? { staffId: staffId || null } : {}),
      ...(amount !== undefined ? { amount } : {}),
    },
    include: chequeInclude,
  });
  res.json(cheque);
}));

// PATCH /api/cheques/:id/status — general status transition
// body: { status, clearanceMethod?, returnReason?, returnNote?, statusDate? }
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status, clearanceMethod, returnReason, returnNote, statusDate } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const existing = await prisma.cheque.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Cheque not found' });

  const newStatusDate = statusDate ? new Date(statusDate) : new Date();
  const totalDays = computeTotalDays(existing.chqDate, newStatusDate);

  const cheque = await prisma.cheque.update({
    where: { id: req.params.id },
    data: {
      status,
      statusDate: newStatusDate,
      totalDays,
      previousStatus: status === 'ON_CHECK' ? existing.status : existing.previousStatus,
      ...(status === 'CLEARED' ? { clearanceMethod: clearanceMethod || 'PRESENTMENT' } : {}),
      ...(status === 'RETURNED' ? { returnReason: returnReason || null, returnNote: returnNote || null } : {}),
    },
    include: chequeInclude,
  });
  res.json(cheque);
}));

// POST /api/cheques/:id/replace — create a replacement cheque for a returned one
router.post('/:id/replace', asyncHandler(async (req, res) => {
  const original = await prisma.cheque.findUnique({ where: { id: req.params.id } });
  if (!original) return res.status(404).json({ error: 'Original cheque not found' });

  const {
    refNo, chqDate, chqNo, bankId, presentedBankId, amount, staffId,
  } = req.body;

  const replacement = await prisma.cheque.create({
    data: {
      receiptId: original.receiptId,
      refNo: refNo ?? original.refNo,
      issuerId: original.issuerId,
      issuedOn: original.issuedOn,
      issuedOnType: original.issuedOnType,
      chequeType: original.chequeType,
      payableToCompany: original.payableToCompany,
      chqDate: new Date(chqDate),
      chqNo,
      bankId: bankId ?? original.bankId,
      presentedBankId: presentedBankId ?? original.presentedBankId,
      amount: amount ?? original.amount,
      staffId: staffId ?? original.staffId,
      replacesChequeId: original.id,
    },
    include: chequeInclude,
  });
  res.status(201).json(replacement);
}));

// POST /api/cheques/:id/followups
router.post('/:id/followups', asyncHandler(async (req, res) => {
  const { response, note, nextActionDate, staffId, followUpDate, updateStatus } = req.body;
  if (!response) return res.status(400).json({ error: 'response is required' });

  const cheque = await prisma.cheque.findUnique({ where: { id: req.params.id } });
  if (!cheque) return res.status(404).json({ error: 'Cheque not found' });

  const followUp = await prisma.chequeFollowUp.create({
    data: {
      chequeId: req.params.id,
      response,
      note,
      nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
      staffId: staffId || null,
      followUpDate: followUpDate ? new Date(followUpDate) : undefined,
    },
  });

  // Optionally move the cheque into the FOLLOWUP status bucket to reflect
  // that it's now in the call/negotiation cycle.
  if (updateStatus !== false && cheque.status === 'PENDING') {
    const newStatusDate = new Date();
    await prisma.cheque.update({
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

// POST /api/cheques/:id/payments — partial/full recovery payment
router.post('/:id/payments', asyncHandler(async (req, res) => {
  const { amount, method, referenceNo, note, paymentDate, staffId } = req.body;
  if (!amount || !method) return res.status(400).json({ error: 'amount and method are required' });

  const cheque = await prisma.cheque.findUnique({
    where: { id: req.params.id },
    include: { payments: true },
  });
  if (!cheque) return res.status(404).json({ error: 'Cheque not found' });

  // The DB trigger (trg_check_cheque_payment_total) also enforces this —
  // this check just gives a friendlier error message before we hit it.
  const alreadyPaid = cheque.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  if (alreadyPaid + Number(amount) > Number(cheque.amount)) {
    return res.status(400).json({
      error: `Payment of ${amount} would push total payments (${alreadyPaid + Number(amount)}) beyond the cheque amount (${cheque.amount})`,
    });
  }

  const payment = await prisma.chequePayment.create({
    data: {
      chequeId: req.params.id,
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
    await prisma.cheque.update({
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

// POST /api/cheques/:id/checklogs — flag as ON_CHECK for manual re-verification
router.post('/:id/checklogs', asyncHandler(async (req, res) => {
  const { reason, raisedById } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const cheque = await prisma.cheque.findUnique({ where: { id: req.params.id } });
  if (!cheque) return res.status(404).json({ error: 'Cheque not found' });

  const checkLog = await prisma.chequeCheckLog.create({
    data: { chequeId: req.params.id, reason, raisedById: raisedById || null },
  });

  const newStatusDate = new Date();
  await prisma.cheque.update({
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

// PATCH /api/cheques/:id/checklogs/:checkLogId/resolve
router.patch('/:id/checklogs/:checkLogId/resolve', asyncHandler(async (req, res) => {
  const { resolvedStatus, resolutionNote } = req.body;
  if (!resolvedStatus) return res.status(400).json({ error: 'resolvedStatus is required' });

  const cheque = await prisma.cheque.findUnique({ where: { id: req.params.id } });
  if (!cheque) return res.status(404).json({ error: 'Cheque not found' });

  const checkLog = await prisma.chequeCheckLog.update({
    where: { id: req.params.checkLogId },
    data: { resolvedAt: new Date(), resolvedStatus, resolutionNote },
  });

  const newStatusDate = new Date();
  await prisma.cheque.update({
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

// DELETE /api/cheques/:id  (soft delete)
router.delete('/:id', asyncHandler(async (req, res) => {
  const cheque = await prisma.cheque.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json(cheque);
}));

export default router;
