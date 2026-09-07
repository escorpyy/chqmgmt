import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

const SAFE_FIELDS = { id: true, username: true, role: true, isActive: true, lastLoginAt: true, createdAt: true };

router.get('/', asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({ select: SAFE_FIELDS, orderBy: { username: 'asc' } });
  res.json(users);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, passwordHash, role: role === 'ADMIN' ? 'ADMIN' : 'STAFF' },
    select: SAFE_FIELDS,
  });
  res.status(201).json(user);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { role, isActive, password } = req.body;

  // Guard against an admin locking themselves out as the last active admin.
  if (role === 'STAFF' || isActive === false) {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (target?.role === 'ADMIN') {
      const otherActiveAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: req.params.id } },
      });
      if (otherActiveAdmins === 0) {
        return res.status(400).json({ error: 'Cannot demote or deactivate the last active admin' });
      }
    }
  }

  const data = {};
  if (role !== undefined) data.role = role === 'ADMIN' ? 'ADMIN' : 'STAFF';
  if (isActive !== undefined) data.isActive = !!isActive;
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const user = await prisma.user.update({ where: { id: req.params.id }, data, select: SAFE_FIELDS });
  res.json(user);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (req.params.id === req.session.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account while logged in' });
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (target?.role === 'ADMIN') {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: 'ADMIN', isActive: true, id: { not: req.params.id } },
    });
    if (otherActiveAdmins === 0) {
      return res.status(400).json({ error: 'Cannot delete the last active admin' });
    }
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
