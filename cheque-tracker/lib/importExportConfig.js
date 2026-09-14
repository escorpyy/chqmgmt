// Central config for the Import / Export feature (see routes/importExport.js).
//
// Every table here is company-scoped (multi-tenant): all of Bank, Staff,
// Party, CompanyBankAccount, FiscalYear, Cheque and IssuedCheque carry a
// required companyId. This file mirrors that everywhere:
//   - export(req):  reads only the signed-in user's currently selected
//                 company (or every company they own, if "all" is selected)
//                 — never the whole database across tenants.
//   - importRow(row, companyId): creates the record under that one company,
//                 and every name-based lookup (bank name -> bank, party
//                 name -> party, etc.) is scoped to that same company, so
//                 you can never accidentally match another company's data.
//   - deleteAll(companyId): wipes only that company's rows in the table.
//
// Each entry describes one table as it should appear in Excel:
//   - columns:    flat column headers, in order (relations are resolved to
//                 their human-readable name, e.g. "bankName" not "bankId")
//   - sampleRows: example row(s) used to build the "Download sample" file
//   - export(req): returns { rows, errors } — rows are flat row objects for
//                 every record that converted cleanly; errors are records
//                 that broke while being converted (e.g. a corrupt legacy
//                 date), each with the best-effort row content plus a
//                 plain-English and a technical explanation. A bad record
//                 is skipped, not fatal to the whole export — see
//                 makeExport() below.
//   - importRow(row, companyId): validates one row and creates the record,
//                 resolving any name-based lookups (bank name -> bankId,
//                 etc.) within that company. Throws on a bad row; the
//                 caller (routes/importExport.js) catches that per-row and
//                 moves on to the next one.
//   - deleteAll(companyId): wipes that company's rows in the table — used
//                 by the "delete existing, then import" mode. FK-restricted
//                 relations will make this throw if other records still
//                 reference the rows; that error is surfaced to the user
//                 rather than swallowed.
//
// This is deliberately separate from routes/*.js: those routes are the
// normal app CRUD API (one record at a time, full validation). This file
// is the bulk-loading counterpart used only by the Import / Export tab.
import { prisma } from './prisma.js';
import { deriveChequeType } from './chequeHelpers.js';
import { companyWhere } from './companyScope.js';
import {
  CHEQUE_STATUSES, ISSUED_STATUSES, PARTY_TYPES,
  isValidEnum, parseDateOrNull, isPositiveAmount,
} from './enums.js';

function excelDate(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function required(row, field, label = field) {
  const value = row[field];
  if (value === undefined || value === null || value.toString().trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value.toString().trim();
}

// Case-insensitive lookup by a single field, scoped to whatever's passed in
// extraWhere — always include companyId there so an import can never match
// another company's bank/party/staff/account by name.
async function findByField(model, field, value, extraWhere = {}) {
  if (!value) return null;
  const target = value.toString().trim().toLowerCase();
  if (!target) return null;
  const rows = await prisma[model].findMany({ where: extraWhere });
  return rows.find((r) => (r[field] || '').toString().trim().toLowerCase() === target) || null;
}

// Turns any thrown error (our own validation Error, or a raw Prisma error)
// into a { nontechnical, technical } pair for the error-report Excel file:
// one column a non-technical person can act on, one column with the real
// detail for whoever has to actually debug it.
export function describeError(err) {
  const message = (err && err.message) || 'Unknown error';
  const code = err && err.code; // Prisma error code, e.g. P2002, P2003
  let nontechnical;
  if (/is required$/.test(message)) {
    nontechnical = 'A required field was left blank.';
  } else if (/was not found/.test(message)) {
    nontechnical = 'This row refers to something (a bank, party, account, staff member, etc.) that doesn\'t exist yet in this company — add it first, or check for a typo in the name.';
  } else if (/must be one of/.test(message)) {
    nontechnical = 'One of the fields has a value that isn\'t one of the allowed options.';
  } else if (/must be a positive number/.test(message)) {
    nontechnical = 'The amount isn\'t a valid positive number.';
  } else if (/is not a valid date/.test(message) || /Invalid time value/.test(message)) {
    nontechnical = 'A date on this row couldn\'t be understood — check the format.';
  } else if (/Argument `company` is missing/.test(message) || /Unknown argument `companyId`/.test(message)) {
    nontechnical = 'This row is missing the company it belongs to — this is an app bug, not a problem with your file.';
  } else if (code === 'P2002') {
    nontechnical = 'A record with this same value already exists in this company (duplicate entry).';
  } else if (code === 'P2003') {
    nontechnical = 'This row is linked to another record that no longer exists.';
  } else {
    nontechnical = 'Something unexpected went wrong while processing this row.';
  }
  const technicalParts = [message];
  if (code) technicalParts.push(`code: ${code}`);
  if (err && err.meta) {
    try { technicalParts.push(`meta: ${JSON.stringify(err.meta)}`); } catch { /* ignore */ }
  }
  return { nontechnical, technical: technicalParts.join(' | ') };
}

// Builds a table's export(req) from a company-scoped record fetcher plus a
// map of column -> extractor function (rather than one big object literal),
// so that if ONE column's extractor throws for ONE record (e.g. a corrupt
// stored date), only that record is dropped from the export and reported
// as an error — the rest of the table still exports normally.
//
// fetchRecords receives the Prisma `where` fragment scoping to the caller's
// selected company (or every company they own, for "all") — see
// companyWhere() in lib/companyScope.js.
function makeExport(fetchRecords, fields) {
  const columns = Object.keys(fields);
  return async function exportTable(req) {
    const records = await fetchRecords(companyWhere(req));
    const rows = [];
    const errors = [];
    for (const record of records) {
      const row = {};
      const fieldErrors = [];
      for (const col of columns) {
        try {
          row[col] = fields[col](record);
        } catch (err) {
          row[col] = '#ERROR';
          fieldErrors.push(`${col}: ${err.message}`);
        }
      }
      if (fieldErrors.length) {
        const idHint = record && record.id ? ` (record id ${record.id})` : '';
        errors.push({ raw: row, ...describeError(new Error(`${fieldErrors.join('; ')}${idHint}`)) });
      } else {
        rows.push(row);
      }
    }
    return { rows, errors };
  };
}

export const TABLES = {
  banks: {
    label: 'Banks',
    columns: ['name', 'branch'],
    sampleRows: [
      { name: 'Nepal Investment Mega Bank', branch: 'Butwal' },
      { name: 'Global IME Bank', branch: 'Bhairahawa' },
    ],
    export: makeExport(
      (companyFilter) => prisma.bank.findMany({ where: companyFilter, orderBy: { name: 'asc' } }),
      {
        name: (b) => b.name,
        branch: (b) => b.branch || '',
      },
    ),
    async importRow(row, companyId) {
      const name = required(row, 'name');
      return prisma.bank.create({ data: { name, branch: row.branch ? row.branch.toString().trim() : null, companyId } });
    },
    async deleteAll(companyId) { await prisma.bank.deleteMany({ where: { companyId } }); },
  },

  staff: {
    label: 'Staff',
    columns: ['name', 'phone'],
    sampleRows: [{ name: 'Ram Sharma', phone: '9800000000' }],
    export: makeExport(
      (companyFilter) => prisma.staff.findMany({ where: companyFilter, orderBy: { name: 'asc' } }),
      {
        name: (s) => s.name,
        phone: (s) => s.phone || '',
      },
    ),
    async importRow(row, companyId) {
      const name = required(row, 'name');
      return prisma.staff.create({ data: { name, phone: row.phone ? row.phone.toString().trim() : null, companyId } });
    },
    async deleteAll(companyId) { await prisma.staff.deleteMany({ where: { companyId } }); },
  },

  parties: {
    label: 'Parties',
    columns: ['type', 'name', 'phone', 'address', 'panNo', 'firmName'],
    sampleRows: [
      { type: 'FIRM', name: 'ABC Traders Pvt. Ltd.', phone: '071-500000', address: 'Butwal-8, Rupandehi', panNo: '600000000', firmName: '' },
      { type: 'INDIVIDUAL', name: 'Hari Bahadur Thapa', phone: '9800000001', address: 'Butwal', panNo: '', firmName: 'ABC Traders Pvt. Ltd.' },
    ],
    export: makeExport(
      (companyFilter) => prisma.party.findMany({
        where: { ...companyFilter, deletedAt: null },
        include: { firm: true },
        orderBy: { name: 'asc' },
      }),
      {
        type: (p) => p.type,
        name: (p) => p.name,
        phone: (p) => p.phone || '',
        address: (p) => p.address || '',
        panNo: (p) => p.panNo || '',
        firmName: (p) => p.firm?.name || '',
      },
    ),
    async importRow(row, companyId) {
      const type = required(row, 'type');
      if (!isValidEnum(type, PARTY_TYPES)) throw new Error(`type must be one of: ${PARTY_TYPES.join(', ')}`);
      const name = required(row, 'name');

      let firmId = null;
      if (type === 'INDIVIDUAL' && row.firmName && row.firmName.toString().trim()) {
        const firm = await findByField('party', 'name', row.firmName, { companyId, deletedAt: null, type: 'FIRM' });
        if (!firm) throw new Error(`firmName "${row.firmName}" was not found among existing FIRM parties`);
        firmId = firm.id;
      }

      return prisma.party.create({
        data: {
          type,
          name,
          phone: row.phone ? row.phone.toString().trim() : null,
          address: row.address ? row.address.toString().trim() : null,
          // Same rule as the regular Parties form: PAN only ever lives
          // directly on a FIRM — an individual's PAN, if any, comes from
          // their affiliated firm instead, never entered on them directly.
          panNo: type === 'FIRM' && row.panNo ? row.panNo.toString().trim() : null,
          firmId,
          companyId,
        },
      });
    },
    async deleteAll(companyId) { await prisma.party.deleteMany({ where: { companyId } }); },
  },

  companyBankAccounts: {
    label: 'Our bank accounts',
    columns: ['bankName', 'accountName', 'accountNumber', 'branch'],
    sampleRows: [
      { bankName: 'Nepal Investment Mega Bank', accountName: 'B Enterprises Pvt. Ltd.', accountNumber: '00100123456', branch: 'Butwal' },
    ],
    export: makeExport(
      (companyFilter) => prisma.companyBankAccount.findMany({
        where: companyFilter,
        include: { bank: true },
        orderBy: { accountName: 'asc' },
      }),
      {
        bankName: (a) => a.bank?.name || '',
        accountName: (a) => a.accountName,
        accountNumber: (a) => a.accountNumber,
        branch: (a) => a.branch || '',
      },
    ),
    async importRow(row, companyId) {
      const bankName = required(row, 'bankName');
      const accountName = required(row, 'accountName');
      const accountNumber = required(row, 'accountNumber');
      const bank = await findByField('bank', 'name', bankName, { companyId });
      if (!bank) throw new Error(`bankName "${bankName}" was not found — add it on the Banks tab first`);
      return prisma.companyBankAccount.create({
        data: {
          bankId: bank.id,
          accountName,
          accountNumber,
          branch: row.branch ? row.branch.toString().trim() : null,
          companyId,
        },
      });
    },
    async deleteAll(companyId) { await prisma.companyBankAccount.deleteMany({ where: { companyId } }); },
  },

  fiscalYears: {
    label: 'Fiscal years',
    columns: ['year'],
    sampleRows: [{ year: '2082/83' }],
    export: makeExport(
      (companyFilter) => prisma.fiscalYear.findMany({ where: companyFilter, orderBy: { year: 'desc' } }),
      { year: (r) => r.year },
    ),
    async importRow(row, companyId) {
      const year = required(row, 'year');
      return prisma.fiscalYear.create({ data: { year, companyId } });
    },
    async deleteAll(companyId) { await prisma.fiscalYear.deleteMany({ where: { companyId } }); },
  },

  cheques: {
    label: 'Received cheques',
    columns: [
      'fiscalYear', 'receiptNo', 'refNo', 'issuerName', 'issuedOn', 'issuedOnType',
      'chqDate', 'chqNo', 'bankName', 'presentedBankName', 'accountNo', 'amount', 'staffName', 'status',
    ],
    sampleRows: [{
      fiscalYear: '2082/83',
      receiptNo: 'UR-001',
      refNo: 'URT-001/01',
      issuerName: 'Hari Bahadur Thapa',
      issuedOn: 'B Enterprises Pvt. Ltd.',
      issuedOnType: 'FIRM',
      chqDate: '2082-04-01',
      chqNo: '0123456',
      bankName: 'Nepal Investment Mega Bank',
      presentedBankName: '',
      accountNo: '',
      amount: 50000,
      staffName: 'Ram Sharma',
      status: 'PENDING',
    }],
    export: makeExport(
      (companyFilter) => prisma.cheque.findMany({
        where: { ...companyFilter, deletedAt: null },
        include: { fiscalYear: true, issuer: true, bank: true, presentedBank: true, staff: true },
        orderBy: { chqDate: 'desc' },
      }),
      {
        fiscalYear: (c) => c.fiscalYear?.year || '',
        receiptNo: (c) => c.receiptNo || '',
        refNo: (c) => c.refNo || '',
        issuerName: (c) => c.issuer?.name || '',
        issuedOn: (c) => c.issuedOn,
        issuedOnType: (c) => c.issuedOnType,
        chqDate: (c) => excelDate(c.chqDate),
        chqNo: (c) => c.chqNo,
        bankName: (c) => c.bank?.name || '',
        presentedBankName: (c) => c.presentedBank?.name || '',
        accountNo: (c) => c.accountNo || '',
        amount: (c) => Number(c.amount),
        staffName: (c) => c.staff?.name || '',
        status: (c) => c.status,
      },
    ),
    async importRow(row, companyId) {
      const fiscalYearText = required(row, 'fiscalYear');
      const issuerName = required(row, 'issuerName');
      const issuedOn = required(row, 'issuedOn');
      const issuedOnType = required(row, 'issuedOnType');
      if (!isValidEnum(issuedOnType, PARTY_TYPES)) throw new Error(`issuedOnType must be one of: ${PARTY_TYPES.join(', ')}`);
      const chqNo = required(row, 'chqNo');
      const bankName = required(row, 'bankName');
      if (!isPositiveAmount(row.amount)) throw new Error('amount must be a positive number');
      const parsedChqDate = parseDateOrNull(row.chqDate);
      if (!parsedChqDate) throw new Error('chqDate is not a valid date (use YYYY-MM-DD)');

      const issuer = await findByField('party', 'name', issuerName, { companyId, deletedAt: null });
      if (!issuer) throw new Error(`issuerName "${issuerName}" was not found — add it on the Parties tab first`);
      const bank = await findByField('bank', 'name', bankName, { companyId });
      if (!bank) throw new Error(`bankName "${bankName}" was not found — add it on the Banks tab first`);

      let presentedBank = null;
      if (row.presentedBankName && row.presentedBankName.toString().trim()) {
        presentedBank = await findByField('bank', 'name', row.presentedBankName, { companyId });
        if (!presentedBank) throw new Error(`presentedBankName "${row.presentedBankName}" was not found`);
      }

      let staff = null;
      if (row.staffName && row.staffName.toString().trim()) {
        staff = await findByField('staff', 'name', row.staffName, { companyId });
        if (!staff) throw new Error(`staffName "${row.staffName}" was not found`);
      }

      let fiscalYear = await prisma.fiscalYear.findFirst({ where: { year: fiscalYearText, companyId } });
      if (!fiscalYear) {
        fiscalYear = await prisma.fiscalYear.create({ data: { year: fiscalYearText, companyId } });
      }

      const status = (row.status && isValidEnum(row.status, CHEQUE_STATUSES) && row.status) || 'PENDING';

      return prisma.cheque.create({
        data: {
          fiscalYearId: fiscalYear.id,
          receiptNo: row.receiptNo ? row.receiptNo.toString().trim() : null,
          refNo: row.refNo ? row.refNo.toString().trim() : null,
          issuerId: issuer.id,
          issuedOn,
          issuedOnType,
          chequeType: deriveChequeType(issuedOnType),
          payableToCompany: issuedOnType === 'FIRM',
          chqDate: parsedChqDate,
          chqNo,
          bankId: bank.id,
          presentedBankId: presentedBank?.id || null,
          accountNo: row.accountNo ? row.accountNo.toString().trim() : null,
          amount: Number(row.amount),
          staffId: staff?.id || null,
          status,
          statusDate: parsedChqDate,
          companyId,
        },
      });
    },
    async deleteAll(companyId) { await prisma.cheque.deleteMany({ where: { companyId } }); },
  },

  issuedCheques: {
    label: 'Issued cheques',
    columns: [
      'accountNumber', 'fiscalYear', 'pvNo', 'chqDate', 'chqNo', 'payeeName', 'payeeType',
      'amount', 'purpose', 'issuedByName', 'status',
    ],
    sampleRows: [{
      accountNumber: '00100123456',
      fiscalYear: '2082/83',
      pvNo: 'PV-1024',
      chqDate: '2082-04-01',
      chqNo: '9876543',
      payeeName: 'ABC Traders Pvt. Ltd.',
      payeeType: 'FIRM',
      amount: 25000,
      purpose: 'Office rent',
      issuedByName: 'Ram Sharma',
      status: 'ISSUED',
    }],
    export: makeExport(
      (companyFilter) => prisma.issuedCheque.findMany({
        where: { ...companyFilter, deletedAt: null },
        include: { companyBankAccount: true, fiscalYear: true, issuedBy: true },
        orderBy: { chqDate: 'desc' },
      }),
      {
        accountNumber: (c) => c.companyBankAccount?.accountNumber || '',
        fiscalYear: (c) => c.fiscalYear?.year || '',
        pvNo: (c) => c.pvNo || '',
        chqDate: (c) => excelDate(c.chqDate),
        chqNo: (c) => c.chqNo,
        payeeName: (c) => c.payeeName || '',
        payeeType: (c) => c.payeeType || '',
        amount: (c) => Number(c.amount),
        purpose: (c) => c.purpose || '',
        issuedByName: (c) => c.issuedBy?.name || '',
        status: (c) => c.status,
      },
    ),
    // Bulk import only creates ordinary payee cheques, not account-to-account
    // transfers — a transfer has no payee/payeeType at all to fill in from a
    // flat spreadsheet row, and is rare enough to not be worth a bulk path
    // yet. Use the "New issued cheque" form's transfer toggle for those.
    async importRow(row, companyId) {
      const accountNumber = required(row, 'accountNumber');
      const fiscalYearText = required(row, 'fiscalYear');
      const chqNo = required(row, 'chqNo');
      const payeeName = required(row, 'payeeName');
      const payeeType = required(row, 'payeeType');
      if (!isValidEnum(payeeType, PARTY_TYPES)) throw new Error(`payeeType must be one of: ${PARTY_TYPES.join(', ')}`);
      if (!isPositiveAmount(row.amount)) throw new Error('amount must be a positive number');
      const parsedChqDate = parseDateOrNull(row.chqDate);
      if (!parsedChqDate) throw new Error('chqDate is not a valid date (use YYYY-MM-DD)');

      const account = await prisma.companyBankAccount.findFirst({ where: { accountNumber, companyId } });
      if (!account) throw new Error(`accountNumber "${accountNumber}" was not found — add it on the Our accounts tab first`);

      // Same find-or-create pattern as the received-cheques import above —
      // fiscalYearId became a required field on IssuedCheque, so every row
      // needs one.
      let fiscalYear = await prisma.fiscalYear.findFirst({ where: { year: fiscalYearText, companyId } });
      if (!fiscalYear) {
        fiscalYear = await prisma.fiscalYear.create({ data: { year: fiscalYearText, companyId } });
      }

      let issuedBy = null;
      if (row.issuedByName && row.issuedByName.toString().trim()) {
        issuedBy = await findByField('staff', 'name', row.issuedByName, { companyId });
        if (!issuedBy) throw new Error(`issuedByName "${row.issuedByName}" was not found`);
      }

      // Optional soft-match: if a party with this exact name exists, link it —
      // otherwise payeeName is still stored as free text (matches how the
      // regular "New issued cheque" form treats an unlisted payee).
      const payeeParty = await findByField('party', 'name', payeeName, { companyId, deletedAt: null });

      const status = (row.status && isValidEnum(row.status, ISSUED_STATUSES) && row.status) || 'ISSUED';

      return prisma.issuedCheque.create({
        data: {
          companyBankAccountId: account.id,
          fiscalYearId: fiscalYear.id,
          pvNo: row.pvNo ? row.pvNo.toString().trim() : null,
          chqNo,
          chqDate: parsedChqDate,
          payeeId: payeeParty?.id || null,
          payeeName,
          payeeType,
          chequeType: deriveChequeType(payeeType),
          amount: Number(row.amount),
          purpose: row.purpose ? row.purpose.toString().trim() : null,
          issuedById: issuedBy?.id || null,
          status,
          statusDate: parsedChqDate,
          companyId,
        },
      });
    },
    async deleteAll(companyId) { await prisma.issuedCheque.deleteMany({ where: { companyId } }); },
  },
};

export const TABLE_KEYS = Object.keys(TABLES);
