// Central config for the Import / Export feature (see routes/importExport.js).
//
// Each entry describes one table as it should appear in Excel:
//   - columns:    flat column headers, in order (relations are resolved to
//                 their human-readable name, e.g. "bankName" not "bankId")
//   - sampleRows: example row(s) used to build the "Download sample" file
//   - export():   returns { rows, errors } — rows are flat row objects for
//                 every record that converted cleanly; errors are records
//                 that broke while being converted (e.g. a corrupt legacy
//                 date), each with the best-effort row content plus a
//                 plain-English and a technical explanation. A bad record
//                 is skipped, not fatal to the whole export — see
//                 makeExport() below.
//   - importRow(row): validates one row and creates the record, resolving
//                 any name-based lookups (bank name -> bankId, etc.). Throws
//                 on a bad row; the caller (routes/importExport.js) catches
//                 that per-row and moves on to the next one.
//   - deleteAll(): wipes the table — used by the "delete existing, then
//                 import" mode. FK-restricted relations will make this
//                 throw if other records still reference the rows; that
//                 error is surfaced to the user rather than swallowed.
//
// This is deliberately separate from routes/*.js: those routes are the
// normal app CRUD API (one record at a time, full validation). This file
// is the bulk-loading counterpart used only by the Import / Export tab.
import { prisma } from './prisma.js';
import { deriveChequeType } from './chequeHelpers.js';
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

// Case-insensitive lookup by a single field, e.g. findByName('bank', 'name', 'ABC Bank').
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
    nontechnical = 'This row refers to something (a bank, party, account, staff member, etc.) that doesn\'t exist yet in the system — add it first, or check for a typo in the name.';
  } else if (/must be one of/.test(message)) {
    nontechnical = 'One of the fields has a value that isn\'t one of the allowed options.';
  } else if (/must be a positive number/.test(message)) {
    nontechnical = 'The amount isn\'t a valid positive number.';
  } else if (/is not a valid date/.test(message) || /Invalid time value/.test(message)) {
    nontechnical = 'A date on this row couldn\'t be understood — check the format.';
  } else if (code === 'P2002') {
    nontechnical = 'A record with this same value already exists (duplicate entry).';
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

// Builds a table's export() from a record fetcher plus a map of
// column -> extractor function (rather than one big object literal), so
// that if ONE column's extractor throws for ONE record (e.g. a corrupt
// stored date), only that record is dropped from the export and reported
// as an error — the rest of the table still exports normally.
function makeExport(fetchRecords, fields) {
  const columns = Object.keys(fields);
  return async function exportTable() {
    const records = await fetchRecords();
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
      () => prisma.bank.findMany({ orderBy: { name: 'asc' } }),
      {
        name: (b) => b.name,
        branch: (b) => b.branch || '',
      },
    ),
    async importRow(row) {
      const name = required(row, 'name');
      return prisma.bank.create({ data: { name, branch: row.branch ? row.branch.toString().trim() : null } });
    },
    async deleteAll() { await prisma.bank.deleteMany(); },
  },

  staff: {
    label: 'Staff',
    columns: ['name', 'phone'],
    sampleRows: [{ name: 'Ram Sharma', phone: '9800000000' }],
    export: makeExport(
      () => prisma.staff.findMany({ orderBy: { name: 'asc' } }),
      {
        name: (s) => s.name,
        phone: (s) => s.phone || '',
      },
    ),
    async importRow(row) {
      const name = required(row, 'name');
      return prisma.staff.create({ data: { name, phone: row.phone ? row.phone.toString().trim() : null } });
    },
    async deleteAll() { await prisma.staff.deleteMany(); },
  },

  parties: {
    label: 'Parties',
    columns: ['type', 'name', 'phone', 'address', 'panNo', 'firmName'],
    sampleRows: [
      { type: 'FIRM', name: 'ABC Traders Pvt. Ltd.', phone: '071-500000', address: 'Butwal-8, Rupandehi', panNo: '600000000', firmName: '' },
      { type: 'INDIVIDUAL', name: 'Hari Bahadur Thapa', phone: '9800000001', address: 'Butwal', panNo: '', firmName: 'ABC Traders Pvt. Ltd.' },
    ],
    export: makeExport(
      () => prisma.party.findMany({
        where: { deletedAt: null },
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
    async importRow(row) {
      const type = required(row, 'type');
      if (!isValidEnum(type, PARTY_TYPES)) throw new Error(`type must be one of: ${PARTY_TYPES.join(', ')}`);
      const name = required(row, 'name');

      let firmId = null;
      if (type === 'INDIVIDUAL' && row.firmName && row.firmName.toString().trim()) {
        const firm = await findByField('party', 'name', row.firmName, { deletedAt: null, type: 'FIRM' });
        if (!firm) throw new Error(`firmName "${row.firmName}" was not found among existing FIRM parties`);
        firmId = firm.id;
      }

      return prisma.party.create({
        data: {
          type,
          name,
          phone: row.phone ? row.phone.toString().trim() : null,
          address: row.address ? row.address.toString().trim() : null,
          panNo: row.panNo ? row.panNo.toString().trim() : null,
          firmId,
        },
      });
    },
    async deleteAll() { await prisma.party.deleteMany(); },
  },

  companyBankAccounts: {
    label: 'Our bank accounts',
    columns: ['bankName', 'accountName', 'accountNumber', 'branch'],
    sampleRows: [
      { bankName: 'Nepal Investment Mega Bank', accountName: 'B Enterprises Pvt. Ltd.', accountNumber: '00100123456', branch: 'Butwal' },
    ],
    export: makeExport(
      () => prisma.companyBankAccount.findMany({
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
    async importRow(row) {
      const bankName = required(row, 'bankName');
      const accountName = required(row, 'accountName');
      const accountNumber = required(row, 'accountNumber');
      const bank = await findByField('bank', 'name', bankName);
      if (!bank) throw new Error(`bankName "${bankName}" was not found — add it on the Banks tab first`);
      return prisma.companyBankAccount.create({
        data: {
          bankId: bank.id,
          accountName,
          accountNumber,
          branch: row.branch ? row.branch.toString().trim() : null,
        },
      });
    },
    async deleteAll() { await prisma.companyBankAccount.deleteMany(); },
  },

  fiscalYears: {
    label: 'Fiscal years',
    columns: ['year'],
    sampleRows: [{ year: '2082/83' }],
    export: makeExport(
      () => prisma.fiscalYear.findMany({ orderBy: { year: 'desc' } }),
      { year: (r) => r.year },
    ),
    async importRow(row) {
      const year = required(row, 'year');
      return prisma.fiscalYear.create({ data: { year } });
    },
    async deleteAll() { await prisma.fiscalYear.deleteMany(); },
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
      () => prisma.cheque.findMany({
        where: { deletedAt: null },
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
    async importRow(row) {
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

      const issuer = await findByField('party', 'name', issuerName, { deletedAt: null });
      if (!issuer) throw new Error(`issuerName "${issuerName}" was not found — add it on the Parties tab first`);
      const bank = await findByField('bank', 'name', bankName);
      if (!bank) throw new Error(`bankName "${bankName}" was not found — add it on the Banks tab first`);

      let presentedBank = null;
      if (row.presentedBankName && row.presentedBankName.toString().trim()) {
        presentedBank = await findByField('bank', 'name', row.presentedBankName);
        if (!presentedBank) throw new Error(`presentedBankName "${row.presentedBankName}" was not found`);
      }

      let staff = null;
      if (row.staffName && row.staffName.toString().trim()) {
        staff = await findByField('staff', 'name', row.staffName);
        if (!staff) throw new Error(`staffName "${row.staffName}" was not found`);
      }

      let fiscalYear = await prisma.fiscalYear.findFirst({ where: { year: fiscalYearText } });
      if (!fiscalYear) {
        fiscalYear = await prisma.fiscalYear.create({ data: { year: fiscalYearText } });
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
        },
      });
    },
    async deleteAll() { await prisma.cheque.deleteMany(); },
  },

  issuedCheques: {
    label: 'Issued cheques',
    columns: [
      'accountNumber', 'chqDate', 'chqNo', 'payeeName', 'payeeType',
      'amount', 'purpose', 'issuedByName', 'status',
    ],
    sampleRows: [{
      accountNumber: '00100123456',
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
      () => prisma.issuedCheque.findMany({
        where: { deletedAt: null },
        include: { companyBankAccount: true, issuedBy: true },
        orderBy: { chqDate: 'desc' },
      }),
      {
        accountNumber: (c) => c.companyBankAccount?.accountNumber || '',
        chqDate: (c) => excelDate(c.chqDate),
        chqNo: (c) => c.chqNo,
        payeeName: (c) => c.payeeName,
        payeeType: (c) => c.payeeType,
        amount: (c) => Number(c.amount),
        purpose: (c) => c.purpose || '',
        issuedByName: (c) => c.issuedBy?.name || '',
        status: (c) => c.status,
      },
    ),
    async importRow(row) {
      const accountNumber = required(row, 'accountNumber');
      const chqNo = required(row, 'chqNo');
      const payeeName = required(row, 'payeeName');
      const payeeType = required(row, 'payeeType');
      if (!isValidEnum(payeeType, PARTY_TYPES)) throw new Error(`payeeType must be one of: ${PARTY_TYPES.join(', ')}`);
      if (!isPositiveAmount(row.amount)) throw new Error('amount must be a positive number');
      const parsedChqDate = parseDateOrNull(row.chqDate);
      if (!parsedChqDate) throw new Error('chqDate is not a valid date (use YYYY-MM-DD)');

      const account = await prisma.companyBankAccount.findFirst({ where: { accountNumber } });
      if (!account) throw new Error(`accountNumber "${accountNumber}" was not found — add it on the Our accounts tab first`);

      let issuedBy = null;
      if (row.issuedByName && row.issuedByName.toString().trim()) {
        issuedBy = await findByField('staff', 'name', row.issuedByName);
        if (!issuedBy) throw new Error(`issuedByName "${row.issuedByName}" was not found`);
      }

      // Optional soft-match: if a party with this exact name exists, link it —
      // otherwise payeeName is still stored as free text (matches how the
      // regular "New issued cheque" form treats an unlisted payee).
      const payeeParty = await findByField('party', 'name', payeeName, { deletedAt: null });

      const status = (row.status && isValidEnum(row.status, ISSUED_STATUSES) && row.status) || 'ISSUED';

      return prisma.issuedCheque.create({
        data: {
          companyBankAccountId: account.id,
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
        },
      });
    },
    async deleteAll() { await prisma.issuedCheque.deleteMany(); },
  },
};

export const TABLE_KEYS = Object.keys(TABLES);
