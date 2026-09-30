import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Clear all processed email records so next sync re-evaluates everything
const pe = await prisma.processedEmail.deleteMany({});
console.log('Cleared processed emails:', pe.count);

// Clear incorrectly classified applications
const apps = await prisma.application.deleteMany({});
console.log('Cleared applications:', apps.count);

await prisma.$disconnect();
console.log('Done! Next sync will re-classify all emails with the improved AI.');
