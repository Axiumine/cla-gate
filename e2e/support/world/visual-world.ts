// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { installationRowIdSchema } from '../../../src/server/adapters/db/installation-row-id.ts';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { seedAllowlist } from './allowlist-rows.ts';
import { seedAudit } from './audit-rows.ts';
import { TENANT } from './ids.ts';
import { withFixedHistory } from './insert.ts';
import { seedPending } from './pending-rows.ts';
import { ALICE, CAROL, DAN, EVERYONE, FRANK } from './people.ts';
import { assertMigrated, ensureSession, ensureUser } from './people-rows.ts';
import { seedSignatures } from './signature-rows.ts';
import { seedTenants } from './tenant-rows.ts';

// E18-S12: the world the visual baselines and the browser accessibility pass look at. It is written once into a database and left
// there: every row has a number and a time of its own, so a second run finds it and writes nothing, and a screen shows the same
// thing in every run. Nothing in it is changed by a spec that only looks. The specs that change things (e2e/flow.spec.ts) build
// a world of their own with new people, so they never add a line to what is photographed here.

/** The people who browse the seeded world, and so need a live session. */
const BROWSING = [ALICE, CAROL, DAN, FRANK] as const;

/**
 * Makes sure the seeded world is in the database, and that the people who browse it have a session that is alive now.
 * @param db the database of the application under test, as its owner (the triggers that tie a row to the clock are switched off).
 * @param now the time the sessions start from.
 */
export async function ensureVisualWorld(db: Kysely<Database>, now: Date): Promise<void> {
  await assertMigrated(db);
  for (const person of EVERYONE) {
    await ensureUser(db, person);
  }
  const written = await db
    .selectFrom('installations')
    .select('id')
    .where('id', '=', installationRowIdSchema.parse(TENANT.id))
    .executeTakeFirst();
  if (written === undefined) {
    await withFixedHistory(db, async (trx) => {
      await seedTenants(trx);
      await seedSignatures(trx);
      await seedAllowlist(trx);
      await seedPending(trx);
      await seedAudit(trx);
    });
  }
  for (const person of BROWSING) {
    await ensureSession(db, person, now);
  }
}
