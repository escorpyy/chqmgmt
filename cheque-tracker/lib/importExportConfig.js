// Central config for the Import / Export feature (see routes/importExport.js).
//
// Each entry describes one table as it should appear in Excel:
//   - columns:    flat column headers, in order (relations are resolved to
//                 their human-readable name, e.g. "bankName" not "bankId")
//   - sampleRows: example row(s) used to build the "Download sample" file
//   - export():   returns an array of flat row objects for the current data
//   - importRow(row): validates one row and creates the record, resolving
//                 any name-based lookups (bank name -> bankId, etc.)
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

export const TABLES = {
  banks: {
    label: 'Banks',
    columns: ['name', 'branch'],
    sampleRows: [
      { name: 'Nepal Investment Mega Bank', branch: 'Butwal' },
      { name: 'Global IME Bank', branch: 'Bhairahawa' },
    ],
    async export() {
      const rows = await prisma.bank.findMany({ orderBy: { name: 'asc' } });
      return rows.map((b) => ({ name: b.name, branch: b.branch || '' }));
    },
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
    async export() {
      const rows = await prisma.staff.findMany({ orderBy: { name: 'asc' } });
      return rows.map((s) => ({ name: s.name, phone: s.phone || '' }));
    },
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
    async export() {
      const rows = await prisma.party.findMany({
        where: { deletedAt: null },
        include: { firm: true },
        orderBy: { name: 'asc' },
      });
      return rows.map((p) => ({
        type: p.type,
        name: p.name,
        phone: p.phone || '',
        address: p.address || '',
        panNo: p.panNo || '',
        firmName: p.firm?.name || '',
      }));
    },
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
    async export() {
      const rows = await prisma.companyBankAccount.findMany({
        include: { bank: true },
        orderBy: { accountName: 'asc' },
      });
      return rows.map((a) => ({
        bankName: a.bank?.name || '',
        accountName: a.accountName,
        accountNumber: a.accountNumber,
        branch: a.branch || '',
      }));
    },
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
    async export() {
      const rows = await prisma.fiscalYear.findMany({ orderBy: { year: 'desc' } });
      return rows.map((r) => ({ year: r.year }));
    },
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
      'chqDate', 'chqNo', 'bankName', 'presentedBankName', 'amount', 'staffName', 'status',
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
      amount: 50000,
      staffName: 'Ram Sharma',
      status: 'PENDING',
    }],
    async export() {
      const rows = await prisma.cheque.findMany({
        where: { deletedAt: null },
        include: { fiscalYear: true, issuer: true, bank: true, presentedBank: true, staff: true },
        orderBy: { chqDate: 'desc' },
      });
      return rows.map((c) => ({
        fiscalYear: c.fiscalYear?.year || '',
        receiptNo: c.receiptNo || '',
        refNo: c.refNo || '',
        issuerName: c.issuer?.name || '',
        issuedOn: c.issuedOn,
        issuedOnType: c.issuedOnType,
        chqDate: excelDate(c.chqDate),
        chqNo: c.chqNo,
        bankName: c.bank?.name || '',
        presentedBankName: c.presentedBank?.name || '',
        amount: Number(c.amount),
        staffName: c.staff?.name || '',
        status: c.status,
      }));
    },
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
    async export() {
      const rows = await prisma.issuedCheque.findMany({
        where: { deletedAt: null },
        include: { companyBankAccount: true, issuedBy: true },
        orderBy: { chqDate: 'desc' },
      });
      return rows.map((c) => ({
        accountNumber: c.companyBankAccount?.accountNumber || '',
        chqDate: excelDate(c.chqDate),
        chqNo: c.chqNo,
        payeeName: c.payeeName,
        payeeType: c.payeeType,
        amount: Number(c.amount),
        purpose: c.purpose || '',
        issuedByName: c.issuedBy?.name || '',
        status: c.status,
      }));
    },
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
