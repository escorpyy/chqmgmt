import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { computeTotalDays, deriveChequeType } from '../lib/chequeHelpers.js';
import {
  CHEQUE_STATUSES, CLEARANCE_METHODS, FOLLOWUP_RESPONSES, RETURN_REASONS,
  PAYMENT_METHODS, PARTY_TYPES, isValidEnum, parseDateOrNull, isPositiveAmount,
} from '../lib/enums.js';

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
  if (!isValidEnum(issuedOnType, PARTY_TYPES)) {
    return res.status(400).json({ error: `issuedOnType must be one of: ${PARTY_TYPES.join(', ')}` });
  }
  if (!isPositiveAmount(amount)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const parsedChqDate = parseDateOrNull(chqDate);
  if (!parsedChqDate) {
    return res.status(400).json({ error: 'chqDate is not a valid date' });
  }

  // payableToCompany is only meaningful when issuedOnType is FIRM; force it
  // to false for INDIVIDUAL payees rather than trusting the client to omit it.
  const cheque = await prisma.cheque.create({
    data: {
      receiptId,
      refNo,
      issuerId,
      issuedOn,
      issuedOnType,
      chequeType: deriveChequeType(issuedOnType),
      payableToCompany: issuedOnType === 'FIRM' ? (payableToCompany ?? true) : false,
      chqDate: parsedChqDate,
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

  const existing = await prisma.cheque.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { payments: true },
  });
  if (!existing) return res.status(404).json({ error: 'Cheque not found' });

  if (amount !== undefined) {
    if (!isPositiveAmount(amount)) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    const alreadyPaid = existing.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (Number(amount) < alreadyPaid) {
      return res.status(400).json({
        error: `amount (${amount}) cannot be less than payments already recorded against this cheque (${alreadyPaid})`,
      });
    }
  }

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
  if (!isValidEnum(status, CHEQUE_STATUSES)) {
    return res.status(400).json({ error: `status must be one of: ${CHEQUE_STATUSES.join(', ')}` });
  }
  if (!isValidEnum(clearanceMethod, CLEARANCE_METHODS)) {
    return res.status(400).json({ error: `clearanceMethod must be one of: ${CLEARANCE_METHODS.join(', ')}` });
  }
  if (!isValidEnum(returnReason, RETURN_REASONS)) {
    return res.status(400).json({ error: `returnReason must be one of: ${RETURN_REASONS.join(', ')}` });
  }

  const existing = await prisma.cheque.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) return res.status(404).json({ error: 'Cheque not found' });

  let newStatusDate = new Date();
  if (statusDate) {
    const parsed = parseDateOrNull(statusDate);
    if (!parsed) return res.status(400).json({ error: 'statusDate is not a valid date' });
    newStatusDate = parsed;
  }
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
  const original = await prisma.cheque.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { replacedBy: true },
  });
  if (!original) return res.status(404).json({ error: 'Original cheque not found' });
  if (original.status !== 'RETURNED') {
    return res.status(400).json({ error: 'Only a RETURNED cheque can be replaced' });
  }
  if (original.replacedBy) {
    return res.status(400).json({ error: 'This cheque has already been replaced' });
  }

  const {
    refNo, chqDate, chqNo, bankId, presentedBankId, amount, staffId,
  } = req.body;

  if (!chqNo) return res.status(400).json({ error: 'chqNo is required' });
  const parsedChqDate = parseDateOrNull(chqDate);
  if (!parsedChqDate) return res.status(400).json({ error: 'chqDate is not a valid date' });
  if (amount !== undefined && !isPositiveAmount(amount)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const replacement = await prisma.cheque.create({
    data: {
      receiptId: original.receiptId,
      refNo: refNo ?? original.refNo,
      issuerId: original.issuerId,
      issuedOn: original.issuedOn,
      issuedOnType: original.issuedOnType,
      chequeType: original.chequeType,
      payableToCompany: original.payableToCompany,
      chqDate: parsedChqDate,
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
  if (!isValidEnum(response, FOLLOWUP_RESPONSES)) {
    return res.status(400).json({ error: `response must be one of: ${FOLLOWUP_RESPONSES.join(', ')}` });
  }
  const parsedNextActionDate = nextActionDate ? parseDateOrNull(nextActionDate) : null;
  if (nextActionDate && !parsedNextActionDate) {
    return res.status(400).json({ error: 'nextActionDate is not a valid date' });
  }
  const parsedFollowUpDate = followUpDate ? parseDateOrNull(followUpDate) : undefined;
  if (followUpDate && !parsedFollowUpDate) {
    return res.status(400).json({ error: 'followUpDate is not a valid date' });
  }

  const cheque = await prisma.cheque.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!cheque) return res.status(404).json({ error: 'Cheque not found' });

  // Create the follow-up and, if applicable, move the cheque into the
  // FOLLOWUP status bucket atomically — a crash between the two used to be
  // able to leave a follow-up logged with no matching status change.
  const newStatusDate = new Date();
  const shouldAdvanceStatus = updateStatus !== false && cheque.status === 'PENDING';

  const [followUp] = await prisma.$transaction([
    prisma.chequeFollowUp.create({
      data: {
        chequeId: req.params.id,
        response,
        note,
        nextActionDate: parsedNextActionDate,
        staffId: staffId || null,
        followUpDate: parsedFollowUpDate,
      },
    }),
    ...(shouldAdvanceStatus
      ? [prisma.cheque.update({
          where: { id: req.params.id },
          data: {
            status: 'FOLLOWUP',
            statusDate: newStatusDate,
            totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
          },
        })]
      : []),
  ]);

  res.status(201).json(followUp);
}));

// POST /api/cheques/:id/payments — partial/full recovery payment
router.post('/:id/payments', asyncHandler(async (req, res) => {
  const { amount, method, referenceNo, note, paymentDate, staffId } = req.body;
  if (!amount || !method) return res.status(400).json({ error: 'amount and method are required' });
  if (!isPositiveAmount(amount)) return res.status(400).json({ error: 'amount must be a positive number' });
  if (!isValidEnum(method, PAYMENT_METHODS)) {
    return res.status(400).json({ error: `method must be one of: ${PAYMENT_METHODS.join(', ')}` });
  }
  const parsedPaymentDate = paymentDate ? parseDateOrNull(paymentDate) : undefined;
  if (paymentDate && !parsedPaymentDate) {
    return res.status(400).json({ error: 'paymentDate is not a valid date' });
  }

  const cheque = await prisma.cheque.findFirst({
    where: { id: req.params.id, deletedAt: null },
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

  // Record the payment and, if it settles the cheque, flip the status in
  // the same transaction so the two writes can't drift apart on failure.
  const newTotal = alreadyPaid + Number(amount);
  const settles = newTotal >= Number(cheque.amount);
  const newStatusDate = new Date();

  const [payment] = await prisma.$transaction([
    prisma.chequePayment.create({
      data: {
        chequeId: req.params.id,
        amount,
        method,
        referenceNo,
        note,
        paymentDate: parsedPaymentDate,
        staffId: staffId || null,
      },
    }),
    ...(settles
      ? [prisma.cheque.update({
          where: { id: req.params.id },
          data: {
            status: 'CLEARED',
            clearanceMethod: 'PARTIAL_RECOVERY',
            statusDate: newStatusDate,
            totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
          },
        })]
      : []),
  ]);

  res.status(201).json(payment);
}));

// POST /api/cheques/:id/checklogs — flag as ON_CHECK for manual re-verification
router.post('/:id/checklogs', asyncHandler(async (req, res) => {
  const { reason, raisedById } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const cheque = await prisma.cheque.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { checkLogs: { where: { resolvedAt: null } } },
  });
  if (!cheque) return res.status(404).json({ error: 'Cheque not found' });
  if (cheque.checkLogs.length > 0) {
    return res.status(400).json({ error: 'This cheque already has an open, unresolved check log' });
  }

  const newStatusDate = new Date();
  const [checkLog] = await prisma.$transaction([
    prisma.chequeCheckLog.create({
      data: { chequeId: req.params.id, reason, raisedById: raisedById || null },
    }),
    prisma.cheque.update({
      where: { id: req.params.id },
      data: {
        status: 'ON_CHECK',
        previousStatus: cheque.status,
        statusDate: newStatusDate,
        totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
      },
    }),
  ]);

  res.status(201).json(checkLog);
}));

// PATCH /api/cheques/:id/checklogs/:checkLogId/resolve
router.patch('/:id/checklogs/:checkLogId/resolve', asyncHandler(async (req, res) => {
  const { resolvedStatus, resolutionNote } = req.body;
  if (!resolvedStatus) return res.status(400).json({ error: 'resolvedStatus is required' });
  if (!isValidEnum(resolvedStatus, CHEQUE_STATUSES) || resolvedStatus === 'ON_CHECK') {
    return res.status(400).json({ error: `resolvedStatus must be one of: ${CHEQUE_STATUSES.filter((s) => s !== 'ON_CHECK').join(', ')}` });
  }

  const cheque = await prisma.cheque.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!cheque) return res.status(404).json({ error: 'Cheque not found' });

  // Must belong to THIS cheque — previously :id and :checkLogId were never
  // cross-checked, so a mismatched pair could resolve a different cheque's
  // check log while updating this cheque's status.
  const checkLog = await prisma.chequeCheckLog.findFirst({
    where: { id: req.params.checkLogId, chequeId: req.params.id },
  });
  if (!checkLog) return res.status(404).json({ error: 'Check log not found for this cheque' });
  if (checkLog.resolvedAt) return res.status(400).json({ error: 'This check log is already resolved' });

  const newStatusDate = new Date();
  const [resolved] = await prisma.$transaction([
    prisma.chequeCheckLog.update({
      where: { id: req.params.checkLogId },
      data: { resolvedAt: newStatusDate, resolvedStatus, resolutionNote },
    }),
    prisma.cheque.update({
      where: { id: req.params.id },
      data: {
        status: resolvedStatus,
        previousStatus: null,
        statusDate: newStatusDate,
        totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
      },
    }),
  ]);

  res.json(resolved);
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
