/**
 * One-off: fills Application.companyKey for rows created before the column existed.
 * Run with: npm run db:backfill
 */
import { PrismaClient } from "@prisma/client";
import { normalizeCompany } from "../src/lib/company";

const prisma = new PrismaClient();

async function main() {
  const apps = await prisma.application.findMany({
    where: { companyKey: "" },
    select: { id: true, company: true },
  });

  let updated = 0;
  for (const app of apps) {
    const key = normalizeCompany(app.company);
    if (!key) continue; // unknown / platform names stay "" (never matched by company)
    await prisma.application.update({ where: { id: app.id }, data: { companyKey: key } });
    updated++;
  }

  console.log(`Checked ${apps.length} application(s); set companyKey on ${updated}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
