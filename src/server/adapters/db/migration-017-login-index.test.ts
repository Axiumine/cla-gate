// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from './schema.ts';
import { migratedTestDatabase, seedSignature, seedTenant } from './test-support.ts';

// The index of the search for a signer by login (E15-S02, migration 017): the expression it covers, that it is neither partial nor
// unique, and that the planner takes it for the predicate of the search.

/** The definition of the index as the catalogue writes it. */
async function indexDefinition(db: Kysely<Database>): Promise<string> {
  const { rows } = await sql<{ indexdef: string }>`
    select indexdef from pg_indexes
    where schemaname = current_schema() and tablename = 'signer_pii' and indexname = 'signer_pii_login_lower_idx'`.execute(
    db,
  );
  expect(rows).toHaveLength(1);
  return rows[0]?.indexdef ?? '';
}

test('the index covers the login in lower case, as the search compares it', async () => {
  const { db } = await migratedTestDatabase();
  expect(await indexDefinition(db)).toMatch(/\(lower\(login\)\)$/u);
});

test('the index is not partial and not unique, so two signers who gave one login are both allowed', async () => {
  const { db } = await migratedTestDatabase();
  expect(await indexDefinition(db)).not.toMatch(/UNIQUE| WHERE /u);
  const tenant = await seedTenant(db);
  await seedSignature(db, tenant, 111);
  await seedSignature(db, tenant, 222);
  await db.updateTable('signer_pii').set({ login: 'Same-Login' }).execute();
  const found = await sql<{
    n: number;
  }>`select count(*)::int as n from signer_pii where lower(login) = lower('SAME-login')`.execute(db);
  expect(found.rows).toEqual([{ n: 2 }]);
});

test('the predicate of the search is answered from the index, not by reading every row', async () => {
  const { db } = await migratedTestDatabase();
  await seedSignature(db, await seedTenant(db), 111);
  const plan = await db.transaction().execute(async (trx) => {
    await sql`set local enable_seqscan = off`.execute(trx);
    const { rows } = await sql<{
      'QUERY PLAN': string;
    }>`explain select signature_id from signer_pii where lower(login) = lower('Login-111')`.execute(trx);
    return rows.map((row) => row['QUERY PLAN']).join('\n');
  });
  expect(plan).toContain('signer_pii_login_lower_idx');
});
