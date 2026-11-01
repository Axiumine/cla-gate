// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { asRuntimeRole, containing, migratedRuntimeDatabase, seedSignature, seedTenant } from './test-support.ts';

// seedTenant(db, 1) creates the publisher with GitHub id 1001 and an installation with GitHub id 5000.
const OTHER_INSTALLATION = sql`(select id from installations where github_installation_id = 10000)`;

const IDENTITY: [string, ReturnType<typeof sql>][] = [
  ['users.github_id', sql`update users set github_id = 9999 where github_id = 1001`],
  ['installations.github_installation_id', sql`update installations set github_installation_id = 999999`],
  ['installations.account_id', sql`update installations set account_id = 1`],
  ['repositories.github_repo_id', sql`update repositories set github_repo_id = 1`],
  ['repositories.installation_id', sql`update repositories set installation_id = ${OTHER_INSTALLATION}`],
  ['cla_documents.installation_id', sql`update cla_documents set installation_id = ${OTHER_INSTALLATION}`],
  ['cla_documents.kind', sql`update cla_documents set kind = 'corporate'`],
];

test.each(IDENTITY)('the runtime role cannot change %s, the identity of the row', async (column, statement) => {
  const { db } = await migratedRuntimeDatabase();
  await seedTenant(db, 1);
  await seedTenant(db, 2);
  await expect(asRuntimeRole(db, (trx) => statement.execute(trx))).rejects.toMatchObject({
    code: '23001',
    message: containing(`${column} is immutable`),
  });
});

test('a signature stays with the person who signed it: github ids cannot be swapped between users', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  const alice = await seedSignature(db, tenant, 111);
  const mallory = await seedSignature(db, tenant, 222);
  const swap = asRuntimeRole(db, async (trx) => {
    await sql`update users set github_id = 9999 where github_id = 111`.execute(trx);
    await sql`update users set github_id = 111 where id = ${mallory.userId}`.execute(trx);
  });
  await expect(swap).rejects.toMatchObject({ code: '23001' });
  const owners = await sql<{ id: number; github_id: number }>`
    select s.id, u.github_id from signatures s join users u on u.id = s.user_id order by s.id`.execute(db);
  expect(owners.rows).toEqual([
    { id: alice.signatureId, github_id: 111 },
    { id: mallory.signatureId, github_id: 222 },
  ]);
});

test('display fields, flags and pointers can still change, and an update that keeps the identity is fine', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  await asRuntimeRole(db, async (trx) => {
    await sql`update users set github_id = github_id, login = 'renamed', name = 'New Name' where github_id = 1001`.execute(
      trx,
    );
    await sql`update installations set account_login = 'renamed-org', suspended_at = now()`.execute(trx);
    await sql`update repositories set full_name = 'renamed-org/repo', enabled = true, cla_document_id = ${tenant.documentId}`.execute(
      trx,
    );
    await sql`update cla_documents set name = 'Renamed CLA'`.execute(trx);
  });
  const repository = await db.selectFrom('repositories').select(['full_name', 'enabled']).executeTakeFirstOrThrow();
  expect(repository).toEqual({ full_name: 'renamed-org/repo', enabled: true });
  const document = await db.selectFrom('cla_documents').select('name').executeTakeFirstOrThrow();
  expect(document.name).toBe('Renamed CLA');
});
