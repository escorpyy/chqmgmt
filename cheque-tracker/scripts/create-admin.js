// One-off CLI to create (or reset) a login. Run with:
//   node scripts/create-admin.js <username> <password> [--staff]
// Defaults to role ADMIN; pass --staff to create a regular staff login instead.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

async function main() {
  const [username, password, flag] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: node scripts/create-admin.js <username> <password> [--staff]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const role = flag === '--staff' ? 'STAFF' : 'ADMIN';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role, isActive: true },
    create: { username, passwordHash, role },
  });

  console.log(`${user.role === 'ADMIN' ? 'Admin' : 'Staff'} user "${user.username}" is ready.`);
}

main()
  .catch((err) => {
    console.error('Failed to create user:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
