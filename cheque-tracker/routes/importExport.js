import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { asyncHandler } from '../lib/asyncHandler.js';
import { TABLES, TABLE_KEYS } from '../lib/importExportConfig.js';

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

function sendWorkbook(res, filename, rows, columns) {
  const worksheet = rows.length
    ? XLSX.utils.json_to_sheet(rows, { header: columns })
    : XLSX.utils.aoa_to_sheet([columns]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

// GET /api/import-export/tables — list of importable/exportable tables,
// used to build the Import / Export tab without hardcoding it in the frontend.
router.get('/tables', asyncHandler(async (req, res) => {
  res.json(TABLE_KEYS.map((key) => ({ key, label: TABLES[key].label, columns: TABLES[key].columns })));
}));

// GET /api/import-export/:table/export — download all current rows as .xlsx
router.get('/:table/export', asyncHandler(async (req, res) => {
  const table = getTable(req.params.table);
  const rows = await table.export();
  sendWorkbook(res, `${req.params.table}.xlsx`, rows, table.columns);
}));

// GET /api/import-export/:table/sample — download a template with example row(s)
router.get('/:table/sample', asyncHandler(async (req, res) => {
  const table = getTable(req.params.table);
  sendWorkbook(res, `${req.params.table}-sample.xlsx`, table.sampleRows, table.columns);
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

  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('The workbook has no sheets');
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  } catch (err) {
    return res.status(400).json({ error: `Could not read the Excel file: ${err.message}` });
  }
  if (!rows.length) {
    return res.status(400).json({ error: 'The uploaded file has no data rows below the header' });
  }

  let deletedAll = false;
  if (mode === 'replace') {
    try {
      await table.deleteAll();
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
      // SheetJS (with cellDates: true) returns real Date objects for date
      // cells; normalize those to plain YYYY-MM-DD strings so the same
      // parseDateOrNull() the rest of the app uses can read them.
      const normalized = {};
      for (const [key, value] of Object.entries(rows[i])) {
        normalized[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
      }
      await table.importRow(normalized);
      created += 1;
    } catch (err) {
      errors.push({ row: sheetRowNumber, message: err.message || 'Unknown error' });
    }
  }

  res.json({
    mode,
    deletedAll,
    totalRows: rows.length,
    created,
    failed: errors.length,
    errors: errors.slice(0, 50),
  });
}));

export default router;
