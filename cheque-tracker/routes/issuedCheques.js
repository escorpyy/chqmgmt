import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { computeTotalDays, deriveChequeType, issuedStageTimestampFields } from '../lib/chequeHelpers.js';
import {
  ISSUED_STATUSES, CLEARANCE_METHODS, ISSUED_FOLLOWUP_RESPONSES, RETURN_REASONS,
  PAYMENT_METHODS, PARTY_TYPES, PAYEE_CATEGORIES, isValidEnum, parseDateOrNull, isPositiveAmount,
} from '../lib/enums.js';
import { companyWhere, requireSingleCompany } from '../lib/companyScope.js';
import { parsePagination, statusWhereFragment, parseSort } from '../lib/listQuery.js';

const router = Router();

const issuedInclude = {
  fiscalYear: true,
  companyBankAccount: { include: { bank: true } },
  transferToAccount: { include: { bank: true } },
  payee: { include: { firm: true } },
  issuedBy: true,
  authority: true,
  followUps: { orderBy: { followUpDate: 'desc' } },
  payments: { orderBy: { paymentDate: 'desc' } },
  checkLogs: { orderBy: { raisedAt: 'desc' } },
  replaces: true,
  replacedBy: true,
};

// A cheque either pays an external party, or transfers between two of our
// own accounts — never both, never neither (also enforced by a DB CHECK
// constraint, so this is belt-and-suspenders, not the only guard).
function isTransfer(transferToAccountId) {
  return !!transferToAccountId;
}

// GET /api/issued-cheques?status=ISSUED&search=abc&page=1&pageSize=50
// status may be a comma-separated list; sort is a comma-separated stack of
// "field:asc|desc". dateFrom/dateTo filter on chqDate (inclusive), either
// end optional. Mirrors routes/cheques.js's filter shape so both ledgers
// behave identically.
router.get('/', asyncHandler(async (req, res) => {
  const { status, search, includeDeleted, sort, fiscalYearId, dateFrom, dateTo, amountMin, amountMax, transfers } = req.query;
  const { page, pageSize, skip, take } = parsePagination(req.query);

  const parsedFrom = parseDateOrNull(dateFrom);
  const parsedTo = parseDateOrNull(dateTo);
  if ((dateFrom !== undefined && dateFrom !== '' && !parsedFrom)
    || (dateTo !== undefined && dateTo !== '' && !parsedTo)) {
    return res.status(400).json({ error: 'dateFrom and dateTo must be valid dates' });
  }
  const hasAmountMin = amountMin !== undefined && amountMin !== '';
  const hasAmountMax = amountMax !== undefined && amountMax !== '';
  const parsedAmountMin = hasAmountMin ? Number(amountMin) : null;
  const parsedAmountMax = hasAmountMax ? Number(amountMax) : null;
  if ((hasAmountMin && (!Number.isFinite(parsedAmountMin) || parsedAmountMin < 0))
    || (hasAmountMax && (!Number.isFinite(parsedAmountMax) || parsedAmountMax < 0))) {
    return res.status(400).json({ error: 'amountMin and amountMax must be non-negative numbers' });
  }
  if (parsedAmountMin !== null && parsedAmountMax !== null && parsedAmountMin > parsedAmountMax) {
    return res.status(400).json({ error: 'amountMin cannot be greater than amountMax' });
  }
  // A date-only query parameter parses at midnight. Use an exclusive upper
  // bound for dateTo so records at any time on the selected end date match.
  const exclusiveTo = parsedTo ? new Date(parsedTo) : null;
  if (exclusiveTo) exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);

  const trimmedSearch = search ? String(search).trim() : '';
  const numericSearch = trimmedSearch !== '' && !isNaN(Number(trimmedSearch)) ? Number(trimmedSearch) : null;
  const matchedStatuses = trimmedSearch
    ? ISSUED_STATUSES.filter((s) => s.replace(/_/g, ' ').toLowerCase().includes(trimmedSearch.toLowerCase()))
    : [];

  const where = {
    ...companyWhere(req),
    ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
    ...statusWhereFragment(status, ISSUED_STATUSES),
    ...(fiscalYearId ? { fiscalYearId } : {}),
    // transfers=only / transfers=hide toggles the register between "just
    // the inter-account movement" and "everything except that" — omitted,
    // both show together as today.
    ...(transfers === 'only' ? { transferToAccountId: { not: null } } : {}),
    ...(transfers === 'hide' ? { transferToAccountId: null } : {}),
    ...((parsedFrom || exclusiveTo)
      ? { chqDate: { ...(parsedFrom ? { gte: parsedFrom } : {}), ...(exclusiveTo ? { lt: exclusiveTo } : {}) } }
      : {}),
    ...((parsedAmountMin !== null || parsedAmountMax !== null)
      ? { amount: { ...(parsedAmountMin !== null ? { gte: parsedAmountMin } : {}), ...(parsedAmountMax !== null ? { lte: parsedAmountMax } : {}) } }
      : {}),
    ...(trimmedSearch
      ? {
          OR: [
            { chqNo: { contains: trimmedSearch, mode: 'insensitive' } },
            { pvNo: { contains: trimmedSearch, mode: 'insensitive' } },
            { purpose: { contains: trimmedSearch, mode: 'insensitive' } },
            { payeeName: { contains: trimmedSearch, mode: 'insensitive' } },
            { payee: { firm: { name: { contains: trimmedSearch, mode: 'insensitive' } } } },
            { companyBankAccount: { bank: { name: { contains: trimmedSearch, mode: 'insensitive' } } } },
            { companyBankAccount: { accountName: { contains: trimmedSearch, mode: 'insensitive' } } },
            { transferToAccount: { accountName: { contains: trimmedSearch, mode: 'insensitive' } } },
            ...(numericSearch !== null ? [{ amount: numericSearch }] : []),
            ...(matchedStatuses.length ? [{ status: { in: matchedStatuses } }] : []),
          ],
        }
      : {}),
  };
  const orderBy = parseSort(sort, [
    'chqDate', 'amount', 'chqNo', 'status', 'statusDate', 'totalDays',
    'pvNo', 'payeeName', 'companyBankAccount.bank.name',
  ], { chqDate: 'desc' });

  const [cheques, total] = await Promise.all([
    prisma.issuedCheque.findMany({
      where,
      include: {
        fiscalYear: true,
        companyBankAccount: { include: { bank: true } },
        transferToAccount: { include: { bank: true } },
        payee: { include: { firm: true } },
        issuedBy: true,
        authority: true,
      },
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
    companyBankAccountId, fiscalYearId, pvNo, chqNo, chqDate,
    payeeId, payeeName, payeeType, payeeCategory, transferToAccountId,
    amount, purpose, issuedById, authorityId,
  } = req.body;

  const transfer = isTransfer(transferToAccountId);
  const required = { companyBankAccountId, fiscalYearId, chqNo, chqDate, amount };
  if (!transfer) {
    required.payeeName = payeeName;
    required.payeeType = payeeType;
  }
  const missing = Object.entries(required).filter(([, v]) => v === undefined || v === null || v === '');
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.map(([k]) => k).join(', ')}` });
  }
  if (transfer && transferToAccountId === companyBankAccountId) {
    return res.status(400).json({ error: 'transferToAccountId cannot be the same account this cheque is drawn from' });
  }
  if (!transfer && !isValidEnum(payeeType, PARTY_TYPES)) {
    return res.status(400).json({ error: `payeeType must be one of: ${PARTY_TYPES.join(', ')}` });
  }
  if (payeeCategory !== undefined && !isValidEnum(payeeCategory, PAYEE_CATEGORIES)) {
    return res.status(400).json({ error: `payeeCategory must be one of: ${PAYEE_CATEGORIES.join(', ')}` });
  }
  if (!isPositiveAmount(amount)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const parsedChqDate = parseDateOrNull(chqDate);
  if (!parsedChqDate) {
    return res.status(400).json({ error: 'chqDate is not a valid date' });
  }

  // The account(s), fiscal year, payee, issuing staff, and authority must
  // all belong to this company.
  const [account, toAccount, fy, payee, issuedBy, authority] = await Promise.all([
    prisma.companyBankAccount.findFirst({ where: { id: companyBankAccountId, companyId, deletedAt: null } }),
    transfer ? prisma.companyBankAccount.findFirst({ where: { id: transferToAccountId, companyId, deletedAt: null } }) : null,
    prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } }),
    payeeId ? prisma.party.findFirst({ where: { id: payeeId, companyId, deletedAt: null } }) : null,
    issuedById ? prisma.staff.findFirst({ where: { id: issuedById, companyId, deletedAt: null } }) : null,
    authorityId ? prisma.staff.findFirst({ where: { id: authorityId, companyId, deletedAt: null } }) : null,
  ]);
  if (!account) return res.status(400).json({ error: 'companyBankAccountId does not belong to the selected company or has been deleted' });
  if (transfer && !toAccount) return res.status(400).json({ error: 'transferToAccountId does not belong to the selected company or has been deleted' });
  if (!fy) return res.status(400).json({ error: 'fiscalYearId does not belong to the selected company' });
  if (payeeId && !payee) return res.status(400).json({ error: 'payeeId does not belong to the selected company or has been deleted' });
  if (issuedById && !issuedBy) return res.status(400).json({ error: 'issuedById does not belong to the selected company or has been deleted' });
  if (authorityId && !authority) return res.status(400).json({ error: 'authorityId does not belong to the selected company or has been deleted' });

  const cheque = await prisma.issuedCheque.create({
    data: {
      companyId,
      companyBankAccountId,
      fiscalYearId,
      pvNo: pvNo || null,
      chqNo,
      chqDate: parsedChqDate,
      payeeId: transfer ? null : (payeeId || null),
      payeeName: transfer ? null : payeeName,
      payeeType: transfer ? null : payeeType,
      payeeCategory: transfer ? null : (payeeCategory || null),
      transferToAccountId: transfer ? transferToAccountId : null,
      // A transfer is always account-payee (never bearer — it's never
      // meant to be cashed); otherwise derived from payeeType as before.
      chequeType: transfer ? 'ACCOUNT_PAYEE' : deriveChequeType(payeeType),
      amount,
      purpose,
      issuedById: issuedById || null,
      authorityId: authorityId || null,
    },
    include: issuedInclude,
  });
  res.status(201).json(cheque);
}));

// PATCH /api/issued-cheques/:id  (edit cheque details)
//
// Two tiers, same pattern as the received-cheque side: purpose, issuedById,
// authorityId, pvNo, payeeCategory, amount, fiscalYearId are freely
// editable; chqDate, chqNo, companyBankAccountId, payeeType are "risky" —
// they feed the @@unique([companyBankAccountId, chqNo]) constraint and/or
// totalDays, so the frontend warns/confirms before sending them, and this
// route re-validates regardless. Whether a cheque is a transfer or an
// external payment is NOT editable after creation — that's a structural
// choice made at issue time, not a field to flip later.
router.patch('/:id', asyncHandler(async (req, res) => {
  const {
    purpose, issuedById, authorityId, pvNo, payeeCategory, amount,
    chqDate, chqNo, companyBankAccountId, payeeType, fiscalYearId,
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

  if (payeeType !== undefined) {
    if (existing.transferToAccountId) {
      return res.status(400).json({ error: 'payeeType does not apply to a transfer between our own accounts' });
    }
    if (!isValidEnum(payeeType, PARTY_TYPES)) {
      return res.status(400).json({ error: `payeeType must be one of: ${PARTY_TYPES.join(', ')}` });
    }
  }
  if (payeeCategory !== undefined && payeeCategory !== null && !isValidEnum(payeeCategory, PAYEE_CATEGORIES)) {
    return res.status(400).json({ error: `payeeCategory must be one of: ${PAYEE_CATEGORIES.join(', ')}` });
  }

  const [account, fy, issuedBy, authority] = await Promise.all([
    companyBankAccountId !== undefined ? prisma.companyBankAccount.findFirst({ where: { id: companyBankAccountId, companyId: existing.companyId, deletedAt: null } }) : true,
    fiscalYearId !== undefined ? prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId: existing.companyId } }) : true,
    issuedById ? prisma.staff.findFirst({ where: { id: issuedById, companyId: existing.companyId, deletedAt: null } }) : true,
    authorityId ? prisma.staff.findFirst({ where: { id: authorityId, companyId: existing.companyId, deletedAt: null } }) : true,
  ]);
  if (companyBankAccountId !== undefined && !account) return res.status(400).json({ error: 'companyBankAccountId does not belong to this cheque\'s company or has been deleted' });
  if (fiscalYearId !== undefined && !fy) return res.status(400).json({ error: 'fiscalYearId does not belong to this cheque\'s company' });
  if (issuedById && !issuedBy) return res.status(400).json({ error: 'issuedById does not belong to this cheque\'s company or has been deleted' });
  if (authorityId && !authority) return res.status(400).json({ error: 'authorityId does not belong to this cheque\'s company or has been deleted' });

  const cheque = await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: {
      ...(purpose !== undefined ? { purpose } : {}),
      ...(issuedById !== undefined ? { issuedById: issuedById || null } : {}),
      ...(authorityId !== undefined ? { authorityId: authorityId || null } : {}),
      ...(pvNo !== undefined ? { pvNo: pvNo || null } : {}),
      ...(payeeCategory !== undefined ? { payeeCategory: payeeCategory || null } : {}),
      ...(amount !== undefined ? { amount } : {}),
      // -- risky fields --
      ...(chqDate !== undefined ? { chqDate: parsedChqDate, totalDays } : {}),
      ...(chqNo !== undefined ? { chqNo } : {}),
      ...(companyBankAccountId !== undefined ? { companyBankAccountId } : {}),
      ...(fiscalYearId !== undefined ? { fiscalYearId } : {}),
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
      fiscalYearId: original.fiscalYearId,
      pvNo: original.pvNo,
      chqNo,
      chqDate: parsedChqDate,
      payeeId: original.payeeId,
      payeeName: original.payeeName,
      payeeType: original.payeeType,
      payeeCategory: original.payeeCategory,
      transferToAccountId: original.transferToAccountId,
      chequeType: original.chequeType,
      amount: amount ?? original.amount,
      purpose: original.purpose,
      issuedById: issuedById ?? original.issuedById,
      authorityId: original.authorityId,
      replacesChequeId: original.id,
    },
    include: issuedInclude,
  });
  res.status(201).json(replacement);
}));

router.post('/:id/followups', asyncHandler(async (req, res) => {
  const { response, note, nextActionDate, staffId, followUpDate } = req.body;
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

  // Just a record of the conversation — the cheque stays RETURNED
  // throughout. There's no more FOLLOWUP status to advance into; the
  // follow-up log itself is the record of "we're on this."
  const followUp = await prisma.issuedChequeFollowUp.create({
    data: {
      issuedChequeId: req.params.id,
      response,
      note,
      nextActionDate: parsedNextActionDate,
      staffId: staffId || null,
      followUpDate: parsedFollowUpDate,
    },
  });

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

// POST /api/issued-cheques/:id/restore
router.post('/:id/restore', asyncHandler(async (req, res) => {
  const existing = await prisma.issuedCheque.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ error: 'Issued cheque not found' });
  const cheque = await prisma.issuedCheque.update({
    where: { id: req.params.id },
    data: { deletedAt: null },
  });
  res.json(cheque);
}));

export default router;
