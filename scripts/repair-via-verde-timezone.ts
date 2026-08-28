/**
 * One-shot: Via Verde dates were parsed with `new Date(y,m,d,h,…)` on a UTC
 * server, so Lisbon wall-clock was stored as UTC. Reinterpret UTC components
 * as Europe/Lisbon. Safe to run once; a marker file prevents a second pass.
 *
 * Usage: npx tsx scripts/repair-via-verde-timezone.ts
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@tvde/database';
import { reinterpretUtcWallClockAsLisbon } from '@tvde/shared';

const MARKER = resolve(process.cwd(), '.via-verde-tz-repaired');

async function main() {
  if (existsSync(MARKER)) {
    console.log('Already repaired (marker exists):', MARKER);
    return;
  }

  const rows = await prisma.viaVerdeMovement.findMany({
    select: {
      id: true,
      entryDate: true,
      exitDate: true,
      paymentDate: true,
      systemEntryDate: true,
    },
  });

  let updated = 0;
  for (const row of rows) {
    const data: {
      entryDate?: Date;
      exitDate?: Date | null;
      paymentDate?: Date | null;
      systemEntryDate?: Date | null;
    } = {};

    if (row.entryDate) data.entryDate = reinterpretUtcWallClockAsLisbon(row.entryDate);
    if (row.exitDate) data.exitDate = reinterpretUtcWallClockAsLisbon(row.exitDate);
    if (row.paymentDate) data.paymentDate = reinterpretUtcWallClockAsLisbon(row.paymentDate);
    if (row.systemEntryDate) {
      data.systemEntryDate = reinterpretUtcWallClockAsLisbon(row.systemEntryDate);
    }

    if (Object.keys(data).length === 0) continue;

    await prisma.viaVerdeMovement.update({ where: { id: row.id }, data });
    updated += 1;
  }

  writeFileSync(
    MARKER,
    `repairedAt=${new Date().toISOString()}\nrows=${updated}\n`,
    'utf8'
  );
  console.log(`Repaired ${updated}/${rows.length} Via Verde movements`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
