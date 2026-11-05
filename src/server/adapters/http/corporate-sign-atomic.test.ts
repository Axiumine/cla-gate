// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  bodyFor,
  type CorporateWorld,
  corporateWorld,
  createdOf,
  failureOf,
  NOTHING_WRITTEN,
  ONE_AGREEMENT,
  postAgreement,
  watchRows,
} from './corporate-fixture/test-support.ts';

// One transaction (E21-S02): the signature, its personal data, the agreement, its text, the signatory approval and the audit row
// are written together or not at all. A trigger that fails the insert into one table stands in for the failure, the last table
// being `audit_log`; whatever was inserted before it must not stay behind, and a retry once the failure is gone succeeds.

type Table =
  | 'signer_pii'
  | 'corporate_agreements'
  | 'corporate_agreement_pii'
  | 'corporate_approvals'
  | 'corporate_approval_pii'
  | 'audit_log';

/** Makes every insert into `table` fail, as a database that goes wrong half way would. */
async function breakInserts(world: CorporateWorld, table: Table): Promise<void> {
  await sql`create function inject_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`.execute(
    world.db,
  );
  await sql`create trigger inject_failure before insert on ${sql.table(table)} for each row execute function inject_failure()`.execute(
    world.db,
  );
}

async function heal(world: CorporateWorld, table: Table): Promise<void> {
  await sql`drop trigger inject_failure on ${sql.table(table)}`.execute(world.db);
}

test.each([
  ['the personal data cannot be stored', 'signer_pii'],
  ['the agreement cannot be stored', 'corporate_agreements'],
  ['the text of the company cannot be stored', 'corporate_agreement_pii'],
  ['the approval of the signatory cannot be stored', 'corporate_approvals'],
  ['the login of the approval cannot be stored', 'corporate_approval_pii'],
  ['the audit row, the last insert, cannot be written', 'audit_log'],
] as const)(
  'when %s the answer is a 500, nothing is left behind in any table, and a retry succeeds',
  async (_label, table) => {
    const world = await corporateWorld();
    const written = await watchRows(world.db);
    await breakInserts(world, table);
    const failed = await postAgreement(
      world,
      world.ada,
      bodyFor(world.c1, { typedName: 'zzzz-typed-name', companyName: 'zzzz Corp' }),
    );
    expect(failureOf(failed)).toEqual([500, 'internal_server_error']);
    expect(failed.body).not.toContain('zzzz');
    expect(failed.body).not.toContain('injected');
    expect(await written()).toEqual(NOTHING_WRITTEN);
    await heal(world, table);
    createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
    expect(await written()).toEqual(ONE_AGREEMENT);
  },
);

test('a failed attempt does not make the next request a repeat: the unique index holds no row of the rolled-back transaction', async () => {
  const world = await corporateWorld();
  await breakInserts(world, 'audit_log');
  expect((await postAgreement(world, world.ada, bodyFor(world.c1))).statusCode).toBe(500);
  await heal(world, 'audit_log');
  expect((await postAgreement(world, world.ada, bodyFor(world.c1))).statusCode).toBe(201);
  expect(failureOf(await postAgreement(world, world.ada, bodyFor(world.c1)))).toEqual([409, 'agreement_exists']);
});
