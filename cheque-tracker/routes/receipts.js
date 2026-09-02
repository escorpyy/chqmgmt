import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const receipts = await prisma.receipt.findMany({
    include: { _count: { select: { cheques: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(receipts);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { fiscalYear, receiptNo } = req.body;
  if (!fiscalYear) return res.status(400).json({ error: 'fiscalYear is required' });
  const receipt = await prisma.receipt.create({ data: { fiscalYear, receiptNo } });
  res.status(201).json(receipt);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const receipt = await prisma.receipt.findUnique({
    where: { id: req.params.id },
    include: { cheques: { include: { issuer: true, bank: true } } },
  });
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
  res.json(receipt);
}));

// PATCH /api/receipts/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const { fiscalYear, receiptNo } = req.body;
  if (fiscalYear !== undefined && !fiscalYear) {
    return res.status(400).json({ error: 'fiscalYear cannot be blank' });
  }
  const receipt = await prisma.receipt.update({
    where: { id: req.params.id },
    data: {
      ...(fiscalYear !== undefined ? { fiscalYear } : {}),
      ...(receiptNo !== undefined ? { receiptNo } : {}),
    },
  });
  res.json(receipt);
}));

export default router;
