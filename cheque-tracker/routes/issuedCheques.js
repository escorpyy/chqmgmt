import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { computeTotalDays, deriveChequeType, issuedStageTimestampFields } from '../lib/chequeHelpers.js';
import {
  ISSUED_STATUSES, CLEARANCE_METHODS, ISSUED_FOLLOWUP_RESPONSES, RETURN_REASONS,
  PAYMENT_METHODS, PARTY_TYPES, isValidEnum, parseDateOrNull, isPositiveAmount,
} from '../lib/enums.js';
import { companyWhere, requireSingleCompany } from '../lib/companyScope.js';
import { parsePagination, statusWhereFragment, parseSort } from '../lib/listQuery.js';

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

// GET /api/issued-cheques?status=ISSUED&search=abc&page=1&pageSize=50
router.get('/', asyncHandler(async (req, res) => {
  const { status, search, includeDeleted, sort } = req.query;
  const { page, pageSize, skip, take } = parsePagination(req.query);

  const where = {
    ...companyWhere(req),
    ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
    ...statusWhereFragment(status, ISSUED_STATUSES),
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
  const orderBy = parseSort(sort, ['chqDate', 'amount', 'chqNo'], { chqDate: 'desc' });

  const [cheques, total] = await Promise.all([
    prisma.issuedCheque.findMany({
      where,
      include: { companyBankAccount: { include: { bank: true } }, payee: true, issuedBy: true },
      orderBy,
      skip,
      take,
    }),
    prisma.issuedCheque.count({ where }),
  ]);
  res.json({ cheques, total, page, pageSize });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const cheque = await prisma.issuedCheque.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: issuedInclude,
  });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });
  res.json(cheque);
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = requireSingleCompany(req, res);
  if (!companyId) return;
  const {
    companyBankAccountId, chqNo, chqDate, payeeId, payeeName, payeeType,
    amount, purpose, issuedById,
  } = req.body;

  const required = { companyBankAccountId, chqNo, chqDate, payeeName, payeeType, amount };
  const missing = Object.entries(required).filter(([, v]) => v === undefined || v === null || v === '');
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.map(([k]) => k).join(', ')}` });
  }
  if (!isValidEnum(payeeType, PARTY_TYPES)) {
    return res.status(400).json({ error: `payeeType must be one of: ${PARTY_TYPES.join(', ')}` });
  }
  if (!isPositiveAmount(amount)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const parsedChqDate = parseDateOrNull(chqDate);
  if (!parsedChqDate) {
    return res.status(400).json({ error: 'chqDate is not a valid date' });
  }

  // The account, payee, and issuing staff must all belong to this company.
  const [account, payee, issuedBy] = await Promise.all([
    prisma.companyBankAccount.findFirst({ where: { id: companyBankAccountId, companyId } }),
    payeeId ? prisma.party.findFirst({ where: { id: payeeId, companyId } }) : null,
    issuedById ? prisma.staff.findFirst({ where: { id: issuedById, companyId } }) : null,
  ]);
  if (!account) return res.status(400).json({ error: 'companyBankAccountId does not belong to the selected company' });
  if (payeeId && !payee) return res.status(400).json({ error: 'payeeId does not belong to the selected company' });
  if (issuedById && !issuedBy) return res.status(400).json({ error: 'issuedById does not belong to the selected company' });

  const cheque = await prisma.issuedCheque.create({
    data: {
      companyId,
      companyBankAccountId,
      chqNo,
      chqDate: parsedChqDate,
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

// PATCH /api/issued-cheques/:id  (edit cheque details)
//
// Two tiers, same pattern as the received-cheque side: purpose, issuedById,
// amount are freely editable; chqDate, chqNo, companyBankAccountId, payeeType
// are "risky" — they feed the @@unique([companyBankAccountId, chqNo])
// constraint and/or totalDays, so the frontend warns/confirms before
// sending them, and this route re-validates regardless.
router.patch('/:id', asyncHandler(async (req, res) => {
  const {
    purpose, issuedById, amount,
    chqDate, chqNo, companyBankAccountId, payeeType,
  } = req.body;

  const existing = await prisma.issuedCheque.findFirst({
    where: { id: req.params.id, deletedAt: null, ...companyWhere(req) },
    include: { payments: true },
  });
  if (!existing) return res.status(404).json({ error: 'Issued cheque not found' });

  if (amount !== undefined) {
    if (!isPositiveAmount(amount)) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    const alreadyPaid = existing.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (Number(amount) < alreadyPaid) {
      return res.status(400).json({
        error: `amount (${amount}) cannot be less than settlements already recorded against this cheque (${alreadyPaid})`,
      });
    }
  }

  let parsedChqDate;
  let totalDays;
  if (chqDate !== undefined) {
    parsedChqDate = parseDateOrNull(chqDate);
    if (!parsedChqDate) return res.status(400).json({ error: 'chqDate is not a valid date' });
    if (parsedChqDate > existing.statusDate) {
      return res.status(400).json({
        error: 'chqDate cannot be after the cheque\'s current status date — update the status date first, or pick an earlier chqDate',
      });
    }
    totalDays = computeTotalDays(parsedChqDate, existing.statusDate);
  }

  if (payeeType !== undefined && !isValidEnum(payeeType, PARTY_TYPES)) {
    return res.status(400).json({ error: `payeeType must be one of: ${PARTY_TYPES.join(', ')}` });
  }

  if (companyBankAccountId !== undefined) {
    const account = await prisma.companyBankAccount.findFirst({ where: { id: companyBankAccountId, companyId: existing.companyId } });
    if (!account) return res.status(400).json({ error: 'companyBankAccountId does not belong to this cheque\'s company' });
  }

  const cheque = await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: {
      ...(purpose !== undefined ? { purpose } : {}),
      ...(issuedById !== undefined ? { issuedById: issuedById || null } : {}),
      ...(amount !== undefined ? { amount } : {}),
      // -- risky fields --
      ...(chqDate !== undefined ? { chqDate: parsedChqDate, totalDays } : {}),
      ...(chqNo !== undefined ? { chqNo } : {}),
      ...(companyBankAccountId !== undefined ? { companyBankAccountId } : {}),
      ...(payeeType !== undefined ? { payeeType, chequeType: deriveChequeType(payeeType) } : {}),
    },
    include: issuedInclude,
  });
  res.json(cheque);
}));

// PATCH /api/issued-cheques/:id/status
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status, clearanceMethod, returnReason, returnNote, statusDate } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });
  if (!isValidEnum(status, ISSUED_STATUSES)) {
    return res.status(400).json({ error: `status must be one of: ${ISSUED_STATUSES.join(', ')}` });
  }
  if (!isValidEnum(clearanceMethod, CLEARANCE_METHODS)) {
    return res.status(400).json({ error: `clearanceMethod must be one of: ${CLEARANCE_METHODS.join(', ')}` });
  }
  if (!isValidEnum(returnReason, RETURN_REASONS)) {
    return res.status(400).json({ error: `returnReason must be one of: ${RETURN_REASONS.join(', ')}` });
  }

  const existing = await prisma.issuedCheque.findFirst({ where: { id: req.params.id, deletedAt: null, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Issued cheque not found' });

  let newStatusDate = new Date();
  if (statusDate) {
    const parsed = parseDateOrNull(statusDate);
    if (!parsed) return res.status(400).json({ error: 'statusDate is not a valid date' });
    newStatusDate = parsed;
  }
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
      ...issuedStageTimestampFields(status, newStatusDate),
    },
    include: issuedInclude,
  });
  res.json(cheque);
}));

// POST /api/issued-cheques/:id/replace
router.post('/:id/replace', asyncHandler(async (req, res) => {
  const original = await prisma.issuedCheque.findFirst({
    where: { id: req.params.id, deletedAt: null, ...companyWhere(req) },
    include: { replacedBy: true },
  });
  if (!original) return res.status(404).json({ error: 'Original issued cheque not found' });
  if (original.status !== 'RETURNED') {
    return res.status(400).json({ error: 'Only a RETURNED issued cheque can be replaced' });
  }
  if (original.replacedBy) {
    return res.status(400).json({ error: 'This issued cheque has already been replaced' });
  }

  const { chqDate, chqNo, companyBankAccountId, amount, issuedById } = req.body;

  if (!chqNo) return res.status(400).json({ error: 'chqNo is required' });
  const parsedChqDate = parseDateOrNull(chqDate);
  if (!parsedChqDate) return res.status(400).json({ error: 'chqDate is not a valid date' });
  if (amount !== undefined && !isPositiveAmount(amount)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const replacement = await prisma.issuedCheque.create({
    data: {
      companyId: original.companyId,
      companyBankAccountId: companyBankAccountId ?? original.companyBankAccountId,
      chqNo,
      chqDate: parsedChqDate,
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
  if (!isValidEnum(response, ISSUED_FOLLOWUP_RESPONSES)) {
    return res.status(400).json({ error: `response must be one of: ${ISSUED_FOLLOWUP_RESPONSES.join(', ')}` });
  }
  const parsedNextActionDate = nextActionDate ? parseDateOrNull(nextActionDate) : null;
  if (nextActionDate && !parsedNextActionDate) {
    return res.status(400).json({ error: 'nextActionDate is not a valid date' });
  }
  const parsedFollowUpDate = followUpDate ? parseDateOrNull(followUpDate) : undefined;
  if (followUpDate && !parsedFollowUpDate) {
    return res.status(400).json({ error: 'followUpDate is not a valid date' });
  }

  const cheque = await prisma.issuedCheque.findFirst({ where: { id: req.params.id, deletedAt: null, ...companyWhere(req) } });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });

  const newStatusDate = new Date();
  const shouldAdvanceStatus = updateStatus !== false && cheque.status === 'RETURNED';

  const [followUp] = await prisma.$transaction([
    prisma.issuedChequeFollowUp.create({
      data: {
        issuedChequeId: req.params.id,
        response,
        note,
        nextActionDate: parsedNextActionDate,
        staffId: staffId || null,
        followUpDate: parsedFollowUpDate,
      },
    }),
    ...(shouldAdvanceStatus
      ? [prisma.issuedCheque.update({
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

  const cheque = await prisma.issuedCheque.findFirst({
    where: { id: req.params.id, deletedAt: null, ...companyWhere(req) },
    include: { payments: true },
  });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });

  const alreadyPaid = cheque.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  if (alreadyPaid + Number(amount) > Number(cheque.amount)) {
    return res.status(400).json({
      error: `Payment of ${amount} would push total payments (${alreadyPaid + Number(amount)}) beyond the cheque amount (${cheque.amount})`,
    });
  }

  const newTotal = alreadyPaid + Number(amount);
  const settles = newTotal >= Number(cheque.amount);
  const newStatusDate = new Date();

  const [payment] = await prisma.$transaction([
    prisma.issuedChequePayment.create({
      data: {
        issuedChequeId: req.params.id,
        amount,
        method,
        referenceNo,
        note,
        paymentDate: parsedPaymentDate,
        staffId: staffId || null,
      },
    }),
    ...(settles
      ? [prisma.issuedCheque.update({
          where: { id: req.params.id },
          data: {
            status: 'CLEARED',
            clearanceMethod: 'PARTIAL_RECOVERY',
            statusDate: newStatusDate,
            totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
            clearedAt: newStatusDate,
          },
        })]
      : []),
  ]);

  res.status(201).json(payment);
}));

router.post('/:id/checklogs', asyncHandler(async (req, res) => {
  const { reason, raisedById } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const cheque = await prisma.issuedCheque.findFirst({
    where: { id: req.params.id, deletedAt: null, ...companyWhere(req) },
    include: { checkLogs: { where: { resolvedAt: null } } },
  });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });
  if (cheque.checkLogs.length > 0) {
    return res.status(400).json({ error: 'This issued cheque already has an open, unresolved check log' });
  }

  const newStatusDate = new Date();
  const [checkLog] = await prisma.$transaction([
    prisma.issuedChequeCheckLog.create({
      data: { issuedChequeId: req.params.id, reason, raisedById: raisedById || null },
    }),
    prisma.issuedCheque.update({
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

router.patch('/:id/checklogs/:checkLogId/resolve', asyncHandler(async (req, res) => {
  const { resolvedStatus, resolutionNote } = req.body;
  if (!resolvedStatus) return res.status(400).json({ error: 'resolvedStatus is required' });
  if (!isValidEnum(resolvedStatus, ISSUED_STATUSES) || resolvedStatus === 'ON_CHECK') {
    return res.status(400).json({ error: `resolvedStatus must be one of: ${ISSUED_STATUSES.filter((s) => s !== 'ON_CHECK').join(', ')}` });
  }

  const cheque = await prisma.issuedCheque.findFirst({ where: { id: req.params.id, deletedAt: null, ...companyWhere(req) } });
  if (!cheque) return res.status(404).json({ error: 'Issued cheque not found' });

  // Must belong to THIS issued cheque — previously :id and :checkLogId were
  // never cross-checked, letting a mismatched pair resolve someone else's
  // check log while updating this cheque's status.
  const checkLog = await prisma.issuedChequeCheckLog.findFirst({
    where: { id: req.params.checkLogId, issuedChequeId: req.params.id },
  });
  if (!checkLog) return res.status(404).json({ error: 'Check log not found for this issued cheque' });
  if (checkLog.resolvedAt) return res.status(400).json({ error: 'This check log is already resolved' });

  const newStatusDate = new Date();
  const [resolved] = await prisma.$transaction([
    prisma.issuedChequeCheckLog.update({
      where: { id: req.params.checkLogId },
      data: { resolvedAt: newStatusDate, resolvedStatus, resolutionNote },
    }),
    prisma.issuedCheque.update({
      where: { id: req.params.id },
      data: {
        status: resolvedStatus,
        previousStatus: null,
        statusDate: newStatusDate,
        totalDays: computeTotalDays(cheque.chqDate, newStatusDate),
        ...issuedStageTimestampFields(resolvedStatus, newStatusDate),
      },
    }),
  ]);

  res.json(resolved);
}));

// DELETE /api/issued-cheques/:id  (soft delete)
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.issuedCheque.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Issued cheque not found' });
  const cheque = await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json(cheque);
}));

export default router;
