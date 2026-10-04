import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { isLocalDatabaseUrl } from './seed-guard';

// Checked before connecting: the test account below must never reach a
// database other people sign in to.
if (!isLocalDatabaseUrl(process.env.DATABASE_URL)) {
  console.error('Seed aborted: DATABASE_URL must point at a database on this machine (localhost).');
  console.error('The seed creates a test account with a known password, so it never runs against a shared or production database.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  // Seed test account
  const hashedPassword = await bcrypt.hash('johndoe123', 12);
  await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: {},
    create: {
      email: 'john@doe.com',
      name: 'John Doe',
      hashedPassword,
    },
  });

  console.log('Seed completed successfully');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
