// Central enum whitelists mirroring prisma/schema.prisma.
// Used to validate request bodies BEFORE handing them to Prisma, so bad
// values produce a friendly 400 instead of an uncaught Prisma validation
// error that falls through to the generic 500 handler in server.js.

export const CHEQUE_STATUSES = ['PENDING', 'FOLLOWUP', 'ON_CHECK', 'PRESENTED', 'CLEARED', 'RETURNED'];
export const ISSUED_STATUSES = ['ISSUED', 'FOLLOWUP', 'ON_CHECK', 'PRESENTED', 'CLEARED', 'RETURNED', 'STOPPED'];
export const CLEARANCE_METHODS = ['PRESENTMENT', 'PARTIAL_RECOVERY'];
export const FOLLOWUP_RESPONSES = ['CONFIRMED', 'REQUESTED_DELAY', 'REQUESTED_REPLACEMENT', 'REQUESTED_PARTIAL_PAYMENT', 'REQUESTED_RETURN', 'UNREACHABLE', 'OTHER'];
export const ISSUED_FOLLOWUP_RESPONSES = ['WILL_REPRESENT', 'REQUESTED_REPLACEMENT', 'REQUESTED_PARTIAL_PAYMENT', 'DISPUTE', 'UNREACHABLE', 'OTHER'];
export const RETURN_REASONS = ['INSUFFICIENT_FUNDS', 'SIGNATURE_MISMATCH', 'ACCOUNT_CLOSED', 'STOPPED_BY_ISSUER', 'DATE_ISSUE', 'OTHER'];
export const PAYMENT_METHODS = ['CASH', 'IPS', 'CIPS', 'QR', 'BANK_DEPOSIT', 'OTHER'];
export const PARTY_TYPES = ['FIRM', 'INDIVIDUAL'];

export function isValidEnum(value, allowed) {
  return value === undefined || value === null || allowed.includes(value);
}

// Parses a date-ish input and returns a Date, or null if unparseable.
export function parseDateOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isPositiveAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}
