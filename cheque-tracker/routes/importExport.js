import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { asyncHandler } from '../lib/asyncHandler.js';
import { TABLES, TABLE_KEYS, describeError } from '../lib/importExportConfig.js';
import { requireSingleCompany } from '../lib/companyScope.js';

const router = Router();

// Files are parsed in memory and never touch disk — small admin-tool
// uploads (reference data, cheque batches), so 10MB is a generous ceiling.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function getTable(key) {
  const table = TABLES[key];
  if (!table) {
    const err = new Error(`Unknown table "${key}". Valid tables: ${TABLE_KEYS.join(', ')}`);
    err.status = 400;
    throw err;
  }
  return table;
}

// FIX (2026): this file used to build/parse workbooks with the `xlsx`
// (SheetJS) package. `xlsx@0.18.5` — the last version SheetJS ever
// published to npm — has two unpatched advisories (prototype pollution,
// GHSA-4r6h-8v6p-xvw6, and a ReDoS, GHSA-5pgg-2g8v-p4x9) with no fix
// available via npm, and it was parsing arbitrary user-uploaded files here.
// `exceljs` was already a dependency (used by routes/dailyBalance.js) and
// has no known vulnerabilities, so both directions (write + read) are
// reimplemented on top of it instead, removing `xlsx` from the app
// entirely — see package.json.

async function sendWorkbook(res, filename, rows, columns) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.columns = columns.map((key) => ({ header: key, key }));
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}

// Builds the "error report" workbook: one row per skipped record, with its
// original column content (best-effort — a column that itself failed to
// read shows as #ERROR) plus two extra columns explaining why it was
// skipped: one in plain language, one with the technical detail.
async function sendErrorReport(res, filename, columns, errorEntries) {
  const reportColumns = [...columns, 'What went wrong', 'Technical detail'];
  const rows = errorEntries.map((e) => ({
    ...columns.reduce((acc, col) => { acc[col] = e.raw?.[col] ?? ''; return acc; }, {}),
    'What went wrong': e.nontechnical,
    'Technical detail': e.technical,
  }));
  await sendWorkbook(res, filename, rows, reportColumns);
}

// Reads the first worksheet of an uploaded .xlsx buffer into an array of
// plain row objects keyed by the header row — the exceljs equivalent of
// SheetJS's `sheet_to_json`. A cell's rich-text/hyperlink/formula-result
// shapes are flattened to their plain value; date-formatted cells come back
// as real JS Date objects (exceljs does this natively), matching the old
// `cellDates: true` behavior so downstream normalization keeps working
// unchanged.
function cellPlainValue(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return value.result ?? ''; // formula cell
    if ('text' in value) return value.text ?? ''; // rich text
    if ('hyperlink' in value) return value.text ?? value.hyperlink ?? '';
  }
  return value;
}

async function readWorkbookRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The workbook has no sheets');

  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const value = cellPlainValue(cell);
    headers[colNumber] = value === '' ? '' : String(value).trim();
  });

  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const obj = {};
    let hasValue = false;
    headers.forEach((header, colNumber) => {
      if (!header) return;
      const value = cellPlainValue(row.getCell(colNumber));
      obj[header] = value;
      if (value !== '' && value !== null && value !== undefined) hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return rows;
}

// GET /api/import-export/tables — list of importable/exportable tables,
// used to build the Import / Export tab without hardcoding it in the frontend.
router.get('/tables', asyncHandler(async (req, res) => {
  res.json(TABLE_KEYS.map((key) => ({ key, label: TABLES[key].label, columns: TABLES[key].columns })));
}));

// GET /api/import-export/:table/export — download all current rows as .xlsx,
// scoped to the caller's selected company (or every company they own, if
// "all" is selected — never cross-tenant). A record that fails to convert
// (e.g. a corrupt legacy date) is skipped rather than failing the whole
// export; how many were skipped is reported via the X-Row-Errors header so
// the frontend can offer the error report.
router.get('/:table/export', asyncHandler(async (req, res) => {
  const table = getTable(req.params.table);
  const { rows, errors } = await table.export(req);
  res.setHeader('X-Row-Errors', String(errors.length));
  res.setHeader('Access-Control-Expose-Headers', 'X-Row-Errors');
  await sendWorkbook(res, `${req.params.table}.xlsx`, rows, table.columns);
}));

// GET /api/import-export/:table/export-errors — the skipped-rows report as
// its own .xlsx, re-run against current data. Only meaningful right after
// an /export that reported X-Row-Errors > 0.
router.get('/:table/export-errors', asyncHandler(async (req, res) => {
  const table = getTable(req.params.table);
  const { errors } = await table.export(req);
  await sendErrorReport(res, `${req.params.table}-export-errors.xlsx`, table.columns, errors);
}));

// GET /api/import-export/:table/sample — download a template with example row(s)
router.get('/:table/sample', asyncHandler(async (req, res) => {
  const table = getTable(req.params.table);
  await sendWorkbook(res, `${req.params.table}-sample.xlsx`, table.sampleRows, table.columns);
}));

// POST /api/import-export/:table/import
// multipart/form-data: file=<xlsx>, mode=append|replace
//   append  — every row in the file is inserted as a new record; existing
//             rows are left untouched. Rows that fail (bad reference,
//             duplicate unique key, etc.) are skipped and reported.
//   replace — ALL existing rows in the table are deleted first, then every
//             row in the file is inserted fresh. If other tables still
//             reference the rows being deleted (e.g. cheques referencing a
//             bank), the delete is rejected outright and nothing is changed.
router.post('/:table/import', upload.single('file'), asyncHandler(async (req, res) => {
  const table = getTable(req.params.table);
  const mode = req.body.mode === 'replace' ? 'replace' : 'append';
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Creating/deleting records only makes sense under one concrete company —
  // "all companies" is a read-only view for export, not a valid import
  // target. requireSingleCompany() sends its own 400 response when nothing
  // specific is selected.
  const companyId = requireSingleCompany(req, res);
  if (!companyId) return;

  let rows;
  try {
    rows = await readWorkbookRows(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `Could not read the Excel file: ${err.message}` });
  }
  if (!rows.length) {
    return res.status(400).json({ error: 'The uploaded file has no data rows below the header' });
  }

  let deletedAll = false;
  if (mode === 'replace') {
    try {
      await table.deleteAll(companyId);
      deletedAll = true;
    } catch (err) {
      return res.status(409).json({
        error: `Could not clear existing rows before import — other records still reference some of them `
          + `(${err.message || 'a related record exists elsewhere'}). Remove or reassign those first, `
          + 'or use "Append" instead of "Delete existing, then import".',
      });
    }
  }

  const errors = [];
  let created = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const sheetRowNumber = i + 2; // +1 for 0-index, +1 for the header row
    try {
      // exceljs (like the old SheetJS cellDates: true) returns real Date
      // objects for date-formatted cells; normalize those to plain
      // YYYY-MM-DD strings so the same parseDateOrNull() the rest of the
      // app uses can read them.
      const normalized = {};
      for (const [key, value] of Object.entries(rows[i])) {
        normalized[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
      }
      await table.importRow(normalized, companyId);
      created += 1;
    } catch (err) {
      // One bad row (bad reference, duplicate key, bad enum value, whatever)
      // never aborts the batch — it's recorded here and the loop moves on
      // to the next row.
      const desc = describeError(err);
      errors.push({
        row: sheetRowNumber,
        raw: { 'Row #': sheetRowNumber, ...rows[i] },
        ...desc,
      });
    }
  }

  let errorReport = null;
  if (errors.length) {
    const reportColumns = ['Row #', ...table.columns];
    const reportRows = errors.map((e) => ({
      ...reportColumns.reduce((acc, col) => { acc[col] = e.raw?.[col] ?? ''; return acc; }, {}),
      'What went wrong': e.nontechnical,
      'Technical detail': e.technical,
    }));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Errors');
    sheet.columns = [...reportColumns, 'What went wrong', 'Technical detail'].map((key) => ({ header: key, key }));
    for (const row of reportRows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    errorReport = {
      filename: `${req.params.table}-import-errors.xlsx`,
      base64: Buffer.from(buffer).toString('base64'),
    };
  }

  res.json({
    mode,
    deletedAll,
    totalRows: rows.length,
    created,
    failed: errors.length,
    errors: errors.slice(0, 50).map((e) => ({ row: e.row, message: e.nontechnical })),
    errorReport,
  });
}));

export default router;
