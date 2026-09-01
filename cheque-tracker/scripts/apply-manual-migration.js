// Applies prisma/manual-migration-additions.sql directly against DATABASE_URL.
// Run this once after your first `npx prisma migrate dev`, and again any
// time you reset the database. Safe to re-run: constraints/triggers use
// ADD CONSTRAINT / CREATE OR REPLACE / DROP ... IF EXISTS patterns, but if
// you run it twice without a reset you may see "constraint already exists"
// errors for step 1-5 — that's expected and can be ignored.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'prisma', 'manual-migration-additions.sql');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    console.log(`Applying ${sqlPath} ...`);
    await client.query(sql);
    console.log('Manual migration additions applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed to apply manual migration additions:');
  console.error(err.message);
  process.exit(1);
});
