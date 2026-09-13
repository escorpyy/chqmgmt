-- ============================================================================
-- Login security: brute-force lockout + forced password change.
--
-- failedLoginAttempts / lockedUntil back the per-account lockout in
-- routes/auth.js (5 wrong passwords locks the account for 15 minutes).
--
-- mustChangePassword forces the password-change modal on next login. It's
-- set true for the auto-provisioned admin account, which as of this
-- migration gets a random password printed once to the server console on
-- creation instead of the old hardcoded "admin"/"admin" — existing admin
-- accounts created before this change are untouched (default false), so
-- nobody already logged in gets unexpectedly locked out of their own app.
-- ============================================================================

ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
