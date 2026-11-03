// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { sharedSigner } from './erasure-fixture/test-support.ts';
import { asRuntimeRole, migratedRuntimeDatabase } from './test-support.ts';

// What the runtime role may do about erasure after migration 009 (E16-S04): run the scoped function, and nothing that would
// let it remove or change personal data any other way. The guarantees of migration 001 hold unchanged.

const DENIED = { code: '42501' };

async function withRuntimeRole() {
  const { db } = await migratedRuntimeDatabase();
  return { db, ...(await sharedSigner(db)) };
}

test('the runtime role executes the scoped function and PUBLIC does not', async () => {
  const { db } = await withRuntimeRole();
  const { rows } = await sql<{ app: boolean; anyone: boolean }>`
    select has_function_privilege('cla_app', 'erase_signer_pii(bigint, bigint, bigint)', 'execute') as app,
           has_function_privilege('public', 'erase_signer_pii(bigint, bigint, bigint)', 'execute') as anyone`.execute(
    db,
  );
  expect(rows).toEqual([{ app: true, anyone: false }]);
});

test('the runtime role erases for one installation through the function, and the other installation keeps its personal data', async () => {
  const { db, t1, person } = await withRuntimeRole();
  const erased = await asRuntimeRole(db, (trx) =>
    sql<{ n: number }>`select erase_signer_pii(${person.githubId}, 9999, ${t1.installationId}) as n`.execute(trx),
  );
  expect(erased.rows).toEqual([{ n: 1 }]);
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toHaveLength(1);
  expect(await db.selectFrom('signatures').select('id').execute()).toHaveLength(2);
  expect(await db.selectFrom('audit_log').select(['action', 'installation_id']).execute()).toEqual([
    { action: 'signer_pii.erased', installation_id: t1.installationId },
  ]);
});

test.each([
  ['a direct DELETE on signer_pii', sql`delete from signer_pii`],
  ['a direct UPDATE on signer_pii', sql`update signer_pii set name = 'x'`],
  ['TRUNCATE of signer_pii', sql`truncate signer_pii`],
  ['TRUNCATE of signatures', sql`truncate signatures`],
  ['DELETE on signatures', sql`delete from signatures`],
  ['TRUNCATE of audit_log', sql`truncate audit_log`],
  ['DELETE on audit_log', sql`delete from audit_log`],
])(
  'the runtime role cannot do %s, so the function is the only way to remove personal data',
  async (_name, statement) => {
    const { db } = await withRuntimeRole();
    await expect(asRuntimeRole(db, (trx) => statement.execute(trx))).rejects.toMatchObject(DENIED);
    const intact = await sql<{ pii: number; signatures: number }>`
    select (select count(*) from signer_pii)::int as pii, (select count(*) from signatures)::int as signatures`.execute(
      db,
    );
    expect(intact.rows).toEqual([{ pii: 2, signatures: 2 }]);
  },
);

test('the function is owned by the migrating role, not the runtime role, and no privilege on signer_pii was added', async () => {
  const { db } = await withRuntimeRole();
  const { rows } = await sql<{ owner: string; remove: boolean; change: boolean }>`
    select pg_get_userbyid(proowner) as owner,
           has_table_privilege('cla_app', 'signer_pii', 'delete') as remove,
           has_table_privilege('cla_app', 'signer_pii', 'update') as change
    from pg_proc where proname = 'erase_signer_pii'`.execute(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.owner).not.toBe('cla_app');
  expect([rows[0]?.remove, rows[0]?.change]).toEqual([false, false]);
});
