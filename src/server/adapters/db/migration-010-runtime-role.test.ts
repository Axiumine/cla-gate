// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  addNetworkColumns,
  CUTOFF,
  networkOf,
  purgeAuditRows,
  setNetwork,
  shifted,
} from './network-metadata-fixture/test-support.ts';
import { asRuntimeRole, migratedRuntimeDatabase, seedSignature, seedTenant } from './test-support.ts';

// What the runtime role may do about the network metadata after migration 010 (E16-S05): run the purge, and nothing that
// would let it change the personal data any other way. The guarantees of migrations 001 and 009 hold unchanged.

const DENIED = { code: '42501' };
const OLDER_THAN_CUTOFF = shifted(CUTOFF, -1);

async function withRuntimeRole() {
  const { db } = await migratedRuntimeDatabase();
  await addNetworkColumns(db);
  const tenant = await seedTenant(db);
  const { signatureId } = await seedSignature(db, tenant, 111);
  await setNetwork(db, signatureId, OLDER_THAN_CUTOFF, { ip: '203.0.113.7', userAgent: 'TestAgent/1.0' });
  return { db, signatureId };
}

test('the runtime role executes the purge and PUBLIC does not', async () => {
  const { db } = await withRuntimeRole();
  const { rows } = await sql<{ app: boolean; anyone: boolean }>`
    select has_function_privilege('cla_app', 'purge_signer_network_metadata(timestamptz)', 'execute') as app,
           has_function_privilege('public', 'purge_signer_network_metadata(timestamptz)', 'execute') as anyone`.execute(
    db,
  );
  expect(rows).toEqual([{ app: true, anyone: false }]);
});

test('the runtime role purges through the function, which writes its audit row, while the personal data stays', async () => {
  const { db, signatureId } = await withRuntimeRole();

  const purged = await asRuntimeRole(db, (trx) =>
    sql<{ n: number }>`select purge_signer_network_metadata(${CUTOFF}::timestamptz) as n`.execute(trx),
  );

  expect(purged.rows).toEqual([{ n: 1 }]);
  expect(await networkOf(db)).toEqual({ [signatureId]: { ip: null, userAgent: null } });
  expect(await purgeAuditRows(db)).toEqual([
    { installation_id: null, actor_github_id: null, subject_type: null, subject_id: null, metadata: { rows: 1 } },
  ]);
  const kept = await db.selectFrom('signer_pii').select(['name', 'email', 'login']).execute();
  expect(kept).toEqual([{ name: 'Name 111', email: 'u111@example.test', login: 'login-111' }]);
});

test.each([
  ['a direct UPDATE of the IP address', sql`update signer_pii set ip_address = null`],
  ['a direct UPDATE of the user agent', sql`update signer_pii set user_agent = null`],
  ['a direct UPDATE of the name', sql`update signer_pii set name = 'x'`],
  ['a direct DELETE on signer_pii', sql`delete from signer_pii`],
  ['TRUNCATE of signatures', sql`truncate signatures`],
  ['DELETE on signatures', sql`delete from signatures`],
  ['TRUNCATE of audit_log', sql`truncate audit_log`],
  ['DELETE on audit_log', sql`delete from audit_log`],
])('the runtime role cannot do %s, so the function is the only way to change the values', async (_name, statement) => {
  const { db, signatureId } = await withRuntimeRole();
  await expect(asRuntimeRole(db, (trx) => statement.execute(trx))).rejects.toMatchObject(DENIED);
  expect(await networkOf(db)).toEqual({ [signatureId]: { ip: '203.0.113.7', userAgent: 'TestAgent/1.0' } });
});

test('the function is owned by the migrating role, and the runtime role has no UPDATE on the table or on either column', async () => {
  const { db } = await withRuntimeRole();
  const { rows } = await sql<{ owner: string; table: boolean; ip: boolean; agent: boolean }>`
    select pg_get_userbyid(proowner) as owner,
           has_table_privilege('cla_app', 'signer_pii', 'update') as table,
           has_column_privilege('cla_app', 'signer_pii', 'ip_address', 'update') as ip,
           has_column_privilege('cla_app', 'signer_pii', 'user_agent', 'update') as agent
    from pg_proc where proname = 'purge_signer_network_metadata'`.execute(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.owner).not.toBe('cla_app');
  expect([rows[0]?.table, rows[0]?.ip, rows[0]?.agent]).toEqual([false, false, false]);
});
