// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { errorCodeOf } from './sign-context-fixture/test-support.ts';
import { NOTHING_WRITTEN, postSign, signedOf, signingWorld, writtenRows } from './sign-fixture/test-support.ts';

// One transaction (E13-S04): the signature, its personal data and its audit row are written together or not at all. A trigger
// that fails the insert into one table stands in for the failure; the signature inserted before it must not stay behind, and a
// retry once the failure is gone succeeds.

type World = Awaited<ReturnType<typeof signingWorld>>['world'];

/** Makes every insert into `table` fail, as a database that goes wrong half way would; the matching `heal` takes it away again. */
async function breakInserts(world: World, table: 'signer_pii' | 'audit_log'): Promise<void> {
  await sql`create function inject_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`.execute(
    world.db,
  );
  await sql`create trigger inject_failure before insert on ${sql.table(table)} for each row execute function inject_failure()`.execute(
    world.db,
  );
}

async function heal(world: World, table: 'signer_pii' | 'audit_log'): Promise<void> {
  await sql`drop trigger inject_failure on ${sql.table(table)}`.execute(world.db);
}

test.each([
  ['the personal data cannot be stored', 'signer_pii' as const],
  ['the audit row cannot be written', 'audit_log' as const],
])('when %s the answer is a 500, nothing is left behind, and a retry succeeds', async (_label, table) => {
  const { world, ada, body } = await signingWorld();
  await breakInserts(world, table);
  const failed = await postSign(world, ada, body({ name: 'zzzz-typed-name' }));
  expect([failed.statusCode, errorCodeOf(failed)]).toEqual([500, 'internal_server_error']);
  expect(failed.body).not.toContain('zzzz');
  expect(failed.body).not.toContain('injected');
  expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
  await heal(world, table);
  const retried = signedOf(await postSign(world, ada, body()), 201);
  expect(retried.created).toBe(true);
  expect(await writtenRows(world.db)).toEqual({ signatures: 1, signerPii: 1, audit: 1 });
});

test('a failed attempt does not make the next request a repeat: the unique index holds no row of the rolled-back transaction', async () => {
  const { world, ada, body } = await signingWorld();
  await breakInserts(world, 'audit_log');
  expect((await postSign(world, ada, body())).statusCode).toBe(500);
  await heal(world, 'audit_log');
  const second = await postSign(world, ada, body());
  const third = await postSign(world, ada, body());
  expect([second.statusCode, third.statusCode]).toEqual([201, 200]);
});
