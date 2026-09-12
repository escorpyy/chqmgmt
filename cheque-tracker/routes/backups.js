import { Router } from 'express';
import multer from 'multer';
import os from 'node:os';
import {
  createBackup,
  enforceRetention,
  listBackups,
  readBackupSettings,
  restoreUploadedBackup,
  startBackupScheduler,
  writeBackupSettings,
} from '../lib/backup.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();
const upload = multer({
  dest: `${os.tmpdir()}/cheque-tracker-restores`,
  limits: { fileSize: 512 * 1024 * 1024 },
});

router.get('/', asyncHandler(async (req, res) => {
  const [settings, backups] = await Promise.all([readBackupSettings(), listBackups()]);
  res.json({ settings, backups: backups.map(({ path, ...backup }) => backup) });
}));

router.patch('/settings', asyncHandler(async (req, res) => {
  const settings = await writeBackupSettings(req.body || {});
  await startBackupScheduler();
  res.json(settings);
}));

router.post('/', asyncHandler(async (req, res) => {
  try {
    const backup = await createBackup('manual');
    await enforceRetention();
    res.status(201).json({ name: backup.name, size: backup.size, createdAt: backup.createdAt });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}));

router.get('/:name/download', asyncHandler(async (req, res) => {
  const backup = (await listBackups()).find((item) => item.name === req.params.name);
  if (!backup) return res.status(404).json({ error: 'Backup not found.' });
  res.download(backup.path, backup.name);
}));

router.post('/restore', upload.single('backup'), asyncHandler(async (req, res) => {
  if (req.body.confirm !== 'RESTORE') return res.status(400).json({ error: 'Type RESTORE to confirm this operation.' });
  if (!req.file) return res.status(400).json({ error: 'A backup file is required.' });

  // Preserve the current database before the destructive restore operation.
  try {
    await createBackup('pre-restore');
    await restoreUploadedBackup(req.file.path);
    res.json({ ok: true, message: 'Database restored. Sign out and sign back in.' });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
}));

export default router;