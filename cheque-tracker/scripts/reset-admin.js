// Reset an existing administrator's password from a trusted server environment.
// Run with: npm run reset-admin -- [username]
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('reset-admin must be run in an interactive terminal');
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = process.stdin.isRaw;
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
      process.stdout.write('\n');
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u0008' || char === '\u007f') {
          value = value.slice(0, -1);
        } else if (char >= ' ' && char !== '\u007f') {
          value += char;
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

async function main() {
  const username = process.argv[2] || 'admin';
  const target = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, role: true },
  });

  if (!target) throw new Error(`User "${username}" was not found.`);
  if (target.role !== 'ADMIN') throw new Error(`User "${username}" is not an administrator.`);

  const password = await readSecret(`New password for ${username}: `);
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  const confirmation = await readSecret('Confirm new password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash } });
  console.log(`Password reset successfully for administrator "${target.username}".`);
}

main()
  .catch((err) => {
    console.error(`Failed to reset administrator password: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());