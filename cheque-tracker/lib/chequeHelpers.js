// totalDays = statusDate - chqDate, in whole days.
// Only meaningful once statusDate >= chqDate (matches the DB CHECK constraint
// in manual-migration-additions.sql); otherwise null.
export function computeTotalDays(chqDate, statusDate) {
  const start = new Date(chqDate);
  const end = new Date(statusDate);
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function deriveChequeType(partyType) {
  return partyType === 'FIRM' ? 'ACCOUNT_PAYEE' : 'BEARER';
}
