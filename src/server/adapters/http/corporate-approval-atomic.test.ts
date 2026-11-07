// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type RawBuilder, sql } from 'kysely';
import { expect, test } from 'vitest';
import { approve, derive } from '../db/corporate-fixture/test-support.ts';
import {
  type ApprovalWorld,
  addAs,
  addedOf,
  approvalWorld,
  carryOverAs,
  revokeAs,
  stateOf,
} from './corporate-approval-fixture/test-support.ts';
import { failureOf, publishMajor, signAs, signedOf } from './corporate-fixture/test-support.ts';

// One transaction (E21-S03): an approval, its login snapshot and its audit row, a revocation with every approval derived from it and
// their audit rows, and the copies of a carry-over are written together or not at all. A trigger that fails an insert stands in for the
// failure; whatever was written before it must not stay behind, and the same request once the failure is gone succeeds.

type Table = 'corporate_approvals' | 'corporate_approval_pii' | 'audit_log';

/** Which rows of the table the failure is for: every one, or the audit rows a cascade or a carry-over writes. */
type Which = 'every' | 'parent_revoked' | 'carried_over';

/** The condition of the trigger for `which`. */
function conditionOf(which: Which): RawBuilder<boolean> {
  switch (which) {
    case 'every':
      return sql<boolean>`true`;
    case 'parent_revoked':
      return sql<boolean>`new.metadata ->> 'reason_code' = 'parent_revoked'`;
    case 'carried_over':
      return sql<boolean>`new.metadata ->> 'reason_code' = 'carried_over'`;
  }
}

/** Makes the inserts into `table` that `which` names fail, as a database that goes wrong half way would. */
async function breakInserts(world: ApprovalWorld, table: Table, which: Which = 'every'): Promise<void> {
  await sql`create function inject_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`.execute(
    world.db,
  );
  await sql`create trigger inject_failure before insert on ${sql.table(table)} for each row when (${conditionOf(which)}) execute function inject_failure()`.execute(
    world.db,
  );
}

async function heal(world: ApprovalWorld, table: Table): Promise<void> {
  await sql`drop trigger inject_failure on ${sql.table(table)}`.execute(world.db);
}

test.each([
  ['the approval cannot be stored', { kind: 'user', login: 'jane-doe' }, 'corporate_approvals'],
  ['the login of the approval cannot be stored', { kind: 'user', login: 'jane-doe' }, 'corporate_approval_pii'],
  ['the audit row of a person, the last insert, cannot be written', { kind: 'user', login: 'jane-doe' }, 'audit_log'],
  ['the audit row of a domain cannot be written', { kind: 'email_domain', domain: 'acme.example' }, 'audit_log'],
] as const)(
  'when %s the answer is a 500, nothing is left behind, and a retry succeeds',
  async (_label, body, table) => {
    const world = await approvalWorld();
    const before = await stateOf(world.db);
    await breakInserts(world, table);
    const failed = await addAs(world, world.ada, world.adas.id, body);
    expect(failureOf(failed)).toEqual([500, 'internal_server_error']);
    expect(failed.body).not.toContain('injected');
    expect(await stateOf(world.db)).toEqual(before);
    await heal(world, table);
    addedOf(await addAs(world, world.ada, world.adas.id, body));
  },
);

test('when the audit row of a revocation cannot be written the approval is not revoked, and a retry succeeds', async () => {
  const world = await approvalWorld();
  const jane = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  const before = await stateOf(world.db);
  await breakInserts(world, 'audit_log');
  const ids = { agreementId: world.adas.id, approvalId: jane.id };
  expect(failureOf(await revokeAs(world, world.ada, ids, { reason: 'left' }))).toEqual([500, 'internal_server_error']);
  expect(await stateOf(world.db)).toEqual(before);
  await heal(world, 'audit_log');
  expect((await revokeAs(world, world.ada, ids, { reason: 'left' })).statusCode).toBe(200);
});

test('when the audit row of a derived approval cannot be written the domain is not revoked either, nor any approval derived from it', async () => {
  const world = await approvalWorld();
  const signed = signedOf(world.c1, world.ada, world.adas);
  const domain = await approve(world.db, signed, { kind: 'email_domain', domain: 'acme.example' });
  await derive(world.db, signed, domain, { githubId: 7101, login: 'one' });
  await derive(world.db, signed, domain, { githubId: 7102, login: 'two' });
  const before = await stateOf(world.db);
  await breakInserts(world, 'audit_log', 'parent_revoked');
  const ids = { agreementId: world.adas.id, approvalId: domain };
  expect(failureOf(await revokeAs(world, world.ada, ids))).toEqual([500, 'internal_server_error']);
  expect(await stateOf(world.db)).toEqual(before);
  await heal(world, 'audit_log');
  expect((await revokeAs(world, world.ada, ids)).statusCode).toBe(200);
});

test('when a copy of a carry-over cannot be audited none of the copies is kept, and a retry copies them all', async () => {
  const world = await approvalWorld();
  addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'acme.example' }));
  const second = await signAs(world, world.ada, world.c1, await publishMajor(world, world.c1, 2));
  const before = await stateOf(world.db);
  await breakInserts(world, 'audit_log', 'carried_over');
  const body = { fromAgreementId: world.adas.id };
  expect(failureOf(await carryOverAs(world, world.ada, second.id, body))).toEqual([500, 'internal_server_error']);
  expect(await stateOf(world.db)).toEqual(before);
  await heal(world, 'audit_log');
  expect((await carryOverAs(world, world.ada, second.id, body)).json()).toEqual({ copied: 2, skipped: 1 });
});
