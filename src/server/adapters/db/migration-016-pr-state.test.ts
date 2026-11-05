// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from './schema.ts';
import { asRuntimeRole, migratedRuntimeDatabase, migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 016 (E15-S01): `pr_evaluations.pr_state` is `open` or `closed`, `open` for a row that does not say, and the table
// stays updatable for the runtime role with no immutability trigger.

const CHECK = { code: '23514' };
const NOT_NULL = { code: '23502' };
const HEAD = 'a'.repeat(40);

/** A migrated database with one repository. */
async function seeded(): Promise<Kysely<Database>> {
  const { db } = await migratedTestDatabase();
  await seedTenant(db, 1);
  return db;
}

/** Stores a row of pull request 1 that says nothing about its state, as every row did before the migration. */
function insertWithoutState(db: Kysely<Database>) {
  return sql<{ pr_state: string }>`
    insert into pr_evaluations (installation_id, repository_id, pr_number, head_sha, result)
    select installation_id, id, 1, ${HEAD}, 'success' from repositories returning pr_state`.execute(db);
}

/** Stores a row of pull request 1 with the state `prState` as SQL text. */
function insertWithState(db: Kysely<Database>, prState: string | null) {
  return sql<{ pr_state: string }>`
    insert into pr_evaluations (installation_id, repository_id, pr_number, head_sha, result, pr_state)
    select installation_id, id, 1, ${HEAD}, 'success', ${prState} from repositories returning pr_state`.execute(db);
}

test('a row that does not name its state is open: the rows that exist before the migration take the default and need no backfill', async () => {
  expect((await insertWithoutState(await seeded())).rows).toEqual([{ pr_state: 'open' }]);
});

test.each([['open'], ['closed']])('the state %s is stored', async (prState) => {
  expect((await insertWithState(await seeded(), prState)).rows).toEqual([{ pr_state: prState }]);
});

test.each([['merged'], ['Open'], ['CLOSED'], ['']])('the state %j is refused by the database', async (prState) => {
  await expect(insertWithState(await seeded(), prState)).rejects.toMatchObject(CHECK);
});

test('a row cannot have no state', async () => {
  await expect(insertWithState(await seeded(), null)).rejects.toMatchObject(NOT_NULL);
});

test('the index covers the installation, the repository, the state and the result, in that order, and is neither partial nor unique', async () => {
  const db = await seeded();
  const { rows } = await sql<{ indexdef: string }>`
    select indexdef from pg_indexes
    where schemaname = current_schema() and tablename = 'pr_evaluations' and indexname = 'pr_evaluations_state_result_idx'`.execute(
    db,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.indexdef).toMatch(/\(installation_id, repository_id, pr_state, result\)$/u);
  expect(rows[0]?.indexdef).not.toMatch(/UNIQUE| WHERE /u);
});

test('the state of a row is updatable by the runtime role, both ways, with no trigger on the table', async () => {
  const { db } = await migratedRuntimeDatabase();
  await seedTenant(db, 1);
  await insertWithoutState(db);
  await asRuntimeRole(db, async (trx) => {
    await trx.updateTable('pr_evaluations').set({ pr_state: 'closed' }).execute();
    expect((await trx.selectFrom('pr_evaluations').select('pr_state').execute()).map((row) => row.pr_state)).toEqual([
      'closed',
    ]);
    await trx.updateTable('pr_evaluations').set({ pr_state: 'open' }).execute();
  });
  const { rows } = await sql<{ triggers: number }>`
    select count(*)::int as triggers from pg_trigger where tgrelid = 'pr_evaluations'::regclass and not tgisinternal`.execute(
    db,
  );
  expect(rows).toEqual([{ triggers: 0 }]);
  expect((await db.selectFrom('pr_evaluations').select('pr_state').execute()).map((row) => row.pr_state)).toEqual([
    'open',
  ]);
});
