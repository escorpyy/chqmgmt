import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

// After this many wrong passwords in a row, the account is locked for this
// long regardless of which IP the attempts came from — the per-IP throttle
// in server.js is a separate, secondary layer on top of this one.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  // Same error for "no such user", "wrong password", and "locked out" —
  // don't let the response shape confirm a username exists or how long is
  // left on a lockout.
  const invalid = () => res.status(401).json({ error: 'Invalid username or password' });
  const lockedOut = () => res.status(429).json({ error: 'Too many failed attempts. Try again later.' });

  if (!user || !user.isActive) return invalid();

  if (user.lockedUntil && user.lockedUntil > new Date()) return lockedOut();

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const locking = attempts >= LOCKOUT_THRESHOLD;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Once locked, the counter itself resets — it did its job, and the
        // lock's own expiry is what matters from here.
        failedLoginAttempts: locking ? 0 : attempts,
        lockedUntil: locking ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
      },
    });
    return locking ? lockedOut() : invalid();
  }

  // Regenerate the session on login to avoid session fixation, then
  // re-populate it (regenerate wipes the session object).
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start session' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    }).catch(() => {});
    res.json({ id: user.id, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword });
  });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.status(204).end();
  });
});

router.get('/me', asyncHandler(async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  // Fetched fresh rather than read off the session — mustChangePassword
  // (and isActive) can change after login, and the very next request
  // after a password change needs to see that immediately.
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, username: true, role: true, isActive: true, mustChangePassword: true },
  });
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ id: user.id, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword });
}));

// POST /api/auth/change-password — used both for the forced first-login
// change and for anyone changing their own password voluntarily later.
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  // 400, not 401 — the session itself is valid (requireAuth already
  // confirmed that); this is a validation failure, and a 401 here would
  // incorrectly trigger the frontend's "session expired" redirect.
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
  });
  res.status(204).end();
}));

export default router;
