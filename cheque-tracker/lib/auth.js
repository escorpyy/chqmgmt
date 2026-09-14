// Session-based auth guards. Session contents are set at login time in
// routes/auth.js: req.session.userId, req.session.username, req.session.role.
//
// FIX (2026): both guards used to trust the session alone, so deactivating a
// user (or demoting an admin) from the Users tab had no effect on that
// user's already-issued session — every route except GET /api/auth/me kept
// working for them for up to 7 days (the cookie's maxAge). requireAuth now
// re-checks isActive against the DB on every request, and req.currentUser
// is populated so downstream handlers/requireAdmin don't need a second
// query. A user deactivated mid-session is now cut off on their very next
// request, not just the next time the frontend happens to call /me.
import { prisma } from './prisma.js';

export async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  // Not wrapped in asyncHandler (this runs before routers, as raw
  // app.use middleware), so a rejected DB call must be forwarded to
  // next(err) explicitly — otherwise it becomes an unhandled rejection
  // instead of hitting the app's error handler.
  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, username: true, role: true, isActive: true },
    });
  } catch (err) {
    return next(err);
  }
  if (!user || !user.isActive) {
    return req.session.destroy(() => {
      res.status(401).json({ error: 'Not authenticated' });
    });
  }
  // Keep the session's role in sync in case it was changed after login,
  // so requireAdmin below (and anything else reading req.session.role)
  // reflects the current value, not the one from login time.
  req.session.role = user.role;
  req.currentUser = user;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.session.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  }).catch(next);
}