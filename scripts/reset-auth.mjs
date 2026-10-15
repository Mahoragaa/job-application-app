import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Delete all accounts so next sign-in starts fresh with full consent
const deleted = await prisma.account.deleteMany({ where: { provider: 'google' } });
console.log('Deleted accounts:', deleted.count);

// Also delete sessions to force re-login
const sessions = await prisma.session.deleteMany({});
console.log('Deleted sessions:', sessions.count);

await prisma.$disconnect();
console.log('Done! Now sign back in — Google will ask for Gmail permission.');
