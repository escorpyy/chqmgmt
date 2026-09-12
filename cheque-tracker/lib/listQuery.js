// Shared helpers for list endpoints that need paging, multi-value status
// filtering, and a whitelisted sort — used by both cheques.js and
// issuedCheques.js so the two ledgers behave identically.

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

// Accepts a single status ("PENDING") or a comma-separated list
// ("PENDING,FOLLOWUP") and returns a Prisma where-fragment, or {} if none
// given. Every value must be in validValues or the whole filter is ignored
// (fails safe to "no filter" rather than erroring on a typo'd status).
export function statusWhereFragment(statusParam, validValues) {
  if (!statusParam) return {};
  const values = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (!values.length || !values.every((v) => validValues.includes(v))) return {};
  return values.length === 1 ? { status: values[0] } : { status: { in: values } };
}

// sort param shape: "field:asc" or "field:desc" — or a comma-separated
// stack of those for multi-level sort ("statusDate:desc,bank.name:desc"),
// where each subsequent entry only breaks ties left by the ones before it.
// Only fields in allowedFields are honored; any single malformed/unknown
// entry is just dropped rather than invalidating the whole stack (fails
// safe, same spirit as before). A field may be a plain scalar ("chqDate")
// or a dotted relation path ("issuer.name"), which becomes a nested Prisma
// orderBy ({ issuer: { name: dir } }). Returns an array — Prisma accepts an
// array of orderBy objects for multi-column sort — or defaultOrderBy
// (typically a single object) when nothing valid was given.
export function parseSort(sortParam, allowedFields, defaultOrderBy) {
  if (!sortParam) return defaultOrderBy;
  const orderBy = [];
  for (const part of sortParam.split(',')) {
    const [field, dir] = part.trim().split(':');
    if (!allowedFields.includes(field) || (dir !== 'asc' && dir !== 'desc')) continue;
    if (field.includes('.')) {
      const [relation, subField] = field.split('.');
      orderBy.push({ [relation]: { [subField]: dir } });
    } else {
      orderBy.push({ [field]: dir });
    }
  }
  return orderBy.length ? orderBy : defaultOrderBy;
}