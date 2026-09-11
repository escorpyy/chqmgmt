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

// Maps a received-cheque status to the persistent per-stage timestamp field
// it should stamp (see the schema note on Cheque.depositedAt etc.) — spread
// the result into any `prisma.cheque.update({ data: { ... } })` call that
// changes `status`, alongside `status`/`statusDate` themselves. Returns {}
// for statuses that don't have a dedicated stage column (FOLLOWUP, ON_CHECK
// are transient/investigative, not lifecycle stages).
export function receivedStageTimestampFields(status, date) {
  switch (status) {
    case 'DEPOSITED': return { depositedAt: date };
    case 'PRESENTED': return { presentedAt: date };
    case 'CLEARED': return { clearedAt: date };
    case 'RETURNED': return { bouncedAt: date };
    case 'CANCELLED': return { cancelledAt: date };
    default: return {};
  }
}

// Same idea for issued cheques. No DEPOSITED case here — see the schema
// note on IssuedCheque (we don't deposit our own issued cheques). STOPPED
// is this side's "cancelled" status, so it stamps cancelledAt.
export function issuedStageTimestampFields(status, date) {
  switch (status) {
    case 'PRESENTED': return { presentedAt: date };
    case 'CLEARED': return { clearedAt: date };
    case 'RETURNED': return { bouncedAt: date };
    case 'STOPPED': return { cancelledAt: date };
    default: return {};
  }
}
