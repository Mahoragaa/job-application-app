import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const account = await prisma.account.findFirst({ where: { provider: 'google' } });
console.log('scope:', account?.scope);
console.log('has_access_token:', !!account?.access_token);
console.log('has_refresh_token:', !!account?.refresh_token);
console.log('expires_at:', account?.expires_at);
await prisma.$disconnect();
