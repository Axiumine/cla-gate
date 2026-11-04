// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
/* eslint-disable sonarjs/no-hardcoded-ip -- the file stores made-up addresses (documentation ranges and a mapped form) and reads them back; none is ever connected to */
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { networkOf, setNetwork } from './network-metadata-fixture/test-support.ts';
import {
  asRuntimeRole,
  containing,
  migratedRuntimeDatabase,
  migratedTestDatabase,
  seedSignature,
  seedTenant,
} from './test-support.ts';

// The optional network columns of signer_pii (E13-S05, migration 014): their types, the limit on the user agent, that they are
// the only network columns of the schema, and that the runtime role may store them with the grant it already has.

const AGENT = 'zzzz-agent/1.0';
const CREATED = '2026-10-20T00:00:00.000Z';

/** A migrated database with a signature, its personal data row and its id. */
async function world(migrate = migratedTestDatabase) {
  const { db } = await migrate();
  const { signatureId } = await seedSignature(db, await seedTenant(db), 111);
  return { db, signatureId };
}

test('ip_address is a nullable inet and user_agent a nullable text, both on signer_pii', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ column_name: string; udt_name: string; is_nullable: string }>`
    select column_name, udt_name, is_nullable from information_schema.columns
    where table_schema = current_schema() and table_name = 'signer_pii' and column_name in ('ip_address', 'user_agent')
    order by column_name`.execute(db);
  expect(rows).toEqual([
    { column_name: 'ip_address', udt_name: 'inet', is_nullable: 'YES' },
    { column_name: 'user_agent', udt_name: 'text', is_nullable: 'YES' },
  ]);
});

test('no network column exists on signatures, audit_log or any other table: the immutable core and the audit trail are free of it', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ name: string }>`
    select table_name || '.' || column_name as name from information_schema.columns
    where table_schema = current_schema() and column_name ~* '(^|_)(ip|ipv4|ipv6|inet|addr|address|agent|ua|network|host|client)(_|$)'
    order by 1`.execute(db);
  expect(rows).toEqual([{ name: 'signer_pii.ip_address' }, { name: 'signer_pii.user_agent' }]);
});

test('a row created without the columns has them NULL, as every signature before the migration does', async () => {
  const { db, signatureId } = await world();
  expect(await networkOf(db)).toEqual({ [signatureId]: { ip: null, userAgent: null } });
});

test.each([
  ['an IPv4 address', '203.0.113.7', '203.0.113.7'],
  ['an IPv6 address', '2001:db8::7', '2001:db8::7'],
  ['an IPv4-mapped IPv6 address', '::ffff:203.0.113.9', '::ffff:203.0.113.9'],
])('the address column stores %s', async (_label, address, read) => {
  const { db, signatureId } = await world();
  await setNetwork(db, signatureId, CREATED, { ip: address, userAgent: null });
  expect(await networkOf(db)).toEqual({ [signatureId]: { ip: read, userAgent: null } });
});

test('the address column refuses text that is not an address', async () => {
  const { db, signatureId } = await world();
  await expect(setNetwork(db, signatureId, CREATED, { ip: 'not-an-address', userAgent: null })).rejects.toMatchObject({
    code: '22P02',
  });
});

test.each([
  ['NULL', null],
  ['a short value', AGENT],
  ['512 characters', 'x'.repeat(512)],
  ['512 characters outside the Basic Multilingual Plane', '\u{1F600}'.repeat(512)],
])('the user agent column accepts %s', async (_label, agent) => {
  const { db, signatureId } = await world();
  await setNetwork(db, signatureId, CREATED, { ip: null, userAgent: agent });
  expect(await networkOf(db)).toEqual({ [signatureId]: { ip: null, userAgent: agent } });
});

test.each([
  ['513 characters', 'x'.repeat(513)],
  ['600 characters', 'x'.repeat(600)],
  ['513 characters outside the Basic Multilingual Plane', '\u{1F600}'.repeat(513)],
])('the user agent column refuses %s by its check, and the row keeps its old values', async (_label, agent) => {
  const { db, signatureId } = await world();
  await setNetwork(db, signatureId, CREATED, { ip: '203.0.113.7', userAgent: AGENT });
  await expect(setNetwork(db, signatureId, CREATED, { ip: null, userAgent: agent })).rejects.toMatchObject({
    code: '23514',
    message: containing('signer_pii_user_agent_length'),
  });
  expect(await networkOf(db)).toEqual({ [signatureId]: { ip: '203.0.113.7', userAgent: AGENT } });
});

test('the runtime role stores and reads the network columns with the table-level INSERT and SELECT it already has', async () => {
  const { db, signatureId } = await world(migratedRuntimeDatabase);
  const userId = (await db.selectFrom('signer_pii').select('user_id').executeTakeFirstOrThrow()).user_id;
  await db.deleteFrom('signer_pii').execute();

  const read = await asRuntimeRole(db, async (trx) => {
    await trx
      .insertInto('signer_pii')
      .values({
        signature_id: signatureId,
        user_id: userId,
        name: 'Name 111',
        email: 'u111@example.test',
        login: 'login-111',
        ip_address: '2001:db8::7',
        user_agent: AGENT,
      })
      .execute();
    return trx.selectFrom('signer_pii').select(['ip_address', 'user_agent']).execute();
  });

  expect(read).toEqual([{ ip_address: '2001:db8::7', user_agent: AGENT }]);
});

test('the privileges of the runtime role on the table are the ones before the migration: select and insert, no update, no delete', async () => {
  const { db } = await world(migratedRuntimeDatabase);
  const { rows } = await sql<{ privilege: string; granted: boolean }>`
    select p as privilege, has_table_privilege('cla_app', 'signer_pii', p) as granted
    from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) as p`.execute(db);
  expect(rows).toEqual([
    { privilege: 'select', granted: true },
    { privilege: 'insert', granted: true },
    { privilege: 'update', granted: false },
    { privilege: 'delete', granted: false },
    { privilege: 'truncate', granted: false },
  ]);
  const columns = await sql<{ ip: boolean; agent: boolean }>`
    select has_column_privilege('cla_app', 'signer_pii', 'ip_address', 'update') as ip,
           has_column_privilege('cla_app', 'signer_pii', 'user_agent', 'update') as agent`.execute(db);
  expect(columns.rows).toEqual([{ ip: false, agent: false }]);
});

test('the erasure as migration 013 defines it takes the network values with the personal data row and clears the allowlist login of the same person, and still reaches an allowlisted account that never signed', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const { signatureId } = await seedSignature(db, tenant, 111);
  await setNetwork(db, signatureId, CREATED, { ip: '203.0.113.7', userAgent: AGENT });
  await db
    .insertInto('allowlist_entries')
    .values([
      {
        installation_id: tenant.installationId,
        kind: 'user',
        github_id: 111,
        created_by: tenant.publisherId,
        login_snapshot: 'ada',
      },
      {
        installation_id: tenant.installationId,
        kind: 'bot',
        github_id: 222,
        created_by: tenant.publisherId,
        login_snapshot: 'ci-bot',
      },
    ])
    .execute();

  const signer = await sql<{ n: number }>`select erase_signer_pii(111, 9999, ${tenant.installationId}) as n`.execute(
    db,
  );
  const listed = await sql<{ n: number }>`select erase_signer_pii(222, 9999, ${tenant.installationId}) as n`.execute(
    db,
  );

  expect([signer.rows, listed.rows]).toEqual([[{ n: 1 }], [{ n: 0 }]]);
  expect(await networkOf(db)).toEqual({});
  expect(
    await db.selectFrom('allowlist_entries').select(['github_id', 'login_snapshot']).orderBy('github_id').execute(),
  ).toEqual([
    { github_id: 111, login_snapshot: null },
    { github_id: 222, login_snapshot: null },
  ]);
});
