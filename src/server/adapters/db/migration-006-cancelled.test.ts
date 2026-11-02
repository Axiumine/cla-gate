// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from './schema.ts';
import { migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 006 (E07-S06): the result of a pull request evaluation can be `cancelled`, and no other new value is accepted.

const CHECK = { code: '23514' };
const HEAD = 'a'.repeat(40);

/** A migrated database with one repository. */
async function seeded(): Promise<Kysely<Database>> {
  const { db } = await migratedTestDatabase();
  await seedTenant(db, 1);
  return db;
}

function insertWithResult(db: Kysely<Database>, result: string) {
  return sql<{ result: string }>`
    insert into pr_evaluations (installation_id, repository_id, pr_number, head_sha, result)
    select installation_id, id, 1, ${HEAD}, ${result} from repositories returning result`.execute(db);
}

const resultsOf = async (db: Kysely<Database>): Promise<string[]> =>
  (await sql<{ result: string }>`select result from pr_evaluations`.execute(db)).rows.map((row) => row.result);

test.each([['in_progress'], ['success'], ['failure'], ['cancelled']])('the result %s is stored', async (result) => {
  expect((await insertWithResult(await seeded(), result)).rows).toEqual([{ result }]);
});

test.each([['maybe'], ['Cancelled'], ['canceled'], ['']])(
  'the result %j is still refused by the database',
  async (result) => {
    await expect(insertWithResult(await seeded(), result)).rejects.toMatchObject(CHECK);
  },
);

test('a row in progress can be set to cancelled, and to in progress again when the pull request is reopened', async () => {
  const db = await seeded();
  await insertWithResult(db, 'in_progress');
  await sql`update pr_evaluations set result = 'cancelled'`.execute(db);
  expect(await resultsOf(db)).toEqual(['cancelled']);
  await sql`update pr_evaluations set result = 'in_progress'`.execute(db);
  expect(await resultsOf(db)).toEqual(['in_progress']);
});
