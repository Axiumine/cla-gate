// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { containing, migratedTestDatabase, publishVersion, seedSignature, seedTenant, sha256 } from './test-support.ts';

// erase_signer_pii(github id, acting administrator, installation) after migration 009 (E16-S04). The tests of the earlier
// two-argument function (migration 001) are these, rewritten for the scoped one. What is specific to the scope (a person in
// two tenants, the allowlist snapshot, the guard) is in migration-009-erasure-scope.test.ts.

const ERASE = (githubId: number, actor: number | null, installationId: number | null) =>
  sql<{ erased: number }>`select erase_signer_pii(${githubId}, ${actor}, ${installationId}) as erased`;

test('erasure deletes the personal data of one person and nothing else', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const alice = await seedSignature(db, tenant, 111);
  const bob = await seedSignature(db, tenant, 222);

  expect((await ERASE(111, 9999, tenant.installationId).execute(db)).rows).toEqual([{ erased: 1 }]);

  expect(await db.selectFrom('signer_pii').select('user_id').execute()).toEqual([{ user_id: bob.userId }]);
  const signatures = await db.selectFrom('signatures').select(['id', 'user_id', 'revoked_at']).orderBy('id').execute();
  expect(signatures).toEqual([
    { id: alice.signatureId, user_id: alice.userId, revoked_at: null },
    { id: bob.signatureId, user_id: bob.userId, revoked_at: null },
  ]);
  const users = await db
    .selectFrom('users')
    .select(['github_id', 'login', 'name', 'avatar_url'])
    .where('github_id', 'in', [111, 222])
    .orderBy('github_id')
    .execute();
  expect(users).toEqual([
    { github_id: 111, login: 'erased-111', name: null, avatar_url: null },
    { github_id: 222, login: 'login-222', name: 'Name 222', avatar_url: 'https://avatars.example/u' },
  ]);
});

test('erasure writes one audit row of the installation that holds ids and counts but no personal data', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await seedSignature(db, tenant, 111);
  await ERASE(111, 9999, tenant.installationId).execute(db);

  const rows = await db.selectFrom('audit_log').selectAll().execute();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    installation_id: tenant.installationId,
    actor_github_id: 9999,
    action: 'signer_pii.erased',
    subject_type: 'user',
    subject_id: 111,
    metadata: { signer_pii_rows: 1 },
  });
  const text = JSON.stringify(rows);
  for (const personal of ['Name 111', 'u111@example.test', 'login-111', 'avatars.example']) {
    expect(text).not.toContain(personal);
  }
});

test('erasure removes every signature row of that person in the installation and can be repeated', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const signer = await seedSignature(db, tenant, 111);
  const v2 = await publishVersion(db, tenant.documentId, tenant.publisherId, {
    major: 2,
    minor: 0,
    text: 'Second major',
  });
  const second = await db
    .insertInto('signatures')
    .values({
      installation_id: tenant.installationId,
      user_id: signer.userId,
      document_id: tenant.documentId,
      version_id: v2.id,
      major: 2,
      content_sha256: sha256('Second major'),
      consent_text_id: 'consent-v2',
      signer_type: 'individual',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('signer_pii')
    .values({ signature_id: second.id, user_id: signer.userId, name: 'N', email: 'e@example.test', login: 'l' })
    .execute();

  expect((await ERASE(111, 9999, tenant.installationId).execute(db)).rows).toEqual([{ erased: 2 }]);
  expect((await ERASE(111, 9999, tenant.installationId).execute(db)).rows).toEqual([{ erased: 0 }]);
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toEqual([]);
  expect(await db.selectFrom('signatures').select('id').execute()).toHaveLength(2);
  const audit = await db.selectFrom('audit_log').select(['actor_github_id', 'metadata']).orderBy('id').execute();
  expect(audit).toEqual([
    { actor_github_id: 9999, metadata: { signer_pii_rows: 2 } },
    { actor_github_id: 9999, metadata: { signer_pii_rows: 0 } },
  ]);
});

test('erasure also ends the sessions of that person and leaves other sessions alone', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const alice = await seedSignature(db, tenant, 111);
  const bob = await seedSignature(db, tenant, 222);
  const session = (userId: number, hash: string) => ({
    session_hash: hash.repeat(64),
    user_id: userId,
    csrf_secret: 'csrf',
    idle_expires_at: new Date(Date.now() + 60_000),
    absolute_expires_at: new Date(Date.now() + 120_000),
  });
  await db
    .insertInto('sessions')
    .values([session(alice.userId, 'a'), session(alice.userId, 'b'), session(bob.userId, 'c')])
    .execute();

  await ERASE(111, 9999, tenant.installationId).execute(db);

  expect(await db.selectFrom('sessions').select('user_id').execute()).toEqual([{ user_id: bob.userId }]);
});

test('personal data cannot be stored again for a signature that predates the erasure, only for a later one', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const signer = await seedSignature(db, tenant, 111);
  const v2 = await publishVersion(db, tenant.documentId, tenant.publisherId, { major: 2, minor: 0, text: 'Second' });
  await ERASE(111, 9999, tenant.installationId).execute(db);

  const pii = (signatureId: number) =>
    db
      .insertInto('signer_pii')
      .values({ signature_id: signatureId, user_id: signer.userId, name: 'N', email: 'e@example.test', login: 'l' })
      .execute();
  await expect(pii(signer.signatureId)).rejects.toMatchObject({ code: '23001', message: containing('erased') });
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toEqual([]);

  const later = await db
    .insertInto('signatures')
    .values({
      installation_id: tenant.installationId,
      user_id: signer.userId,
      document_id: tenant.documentId,
      version_id: v2.id,
      major: 2,
      content_sha256: sha256('Second'),
      consent_text_id: 'consent-v2',
      signer_type: 'individual',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await pii(later.id);
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toEqual([{ signature_id: later.id }]);
});

test.each([
  ['no administrator', null, true],
  ['a non-positive administrator id', 0, true],
  ['no installation', 9999, false],
] as const)('erasure refuses %s and changes nothing', async (_case, actor, withInstallation) => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await seedSignature(db, tenant, 111);
  await expect(ERASE(111, actor, withInstallation ? tenant.installationId : null).execute(db)).rejects.toMatchObject({
    code: '22023',
  });
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toHaveLength(1);
  expect(await db.selectFrom('users').select('login').where('github_id', '=', 111).execute()).toEqual([
    { login: 'login-111' },
  ]);
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
});

test.each([
  ['an unknown person', 424_242, true],
  ['an unknown installation', 111, false],
] as const)('erasing %s fails with no_data_found and audits nothing', async (_case, githubId, installationExists) => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await seedSignature(db, tenant, 111);
  await expect(
    ERASE(githubId, 1, installationExists ? tenant.installationId : 987_654).execute(db),
  ).rejects.toMatchObject({ code: 'P0002' });
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toHaveLength(1);
});

test('exactly one function is named erase_signer_pii: the three-argument one, SECURITY DEFINER with a pinned search_path', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{
    args: string;
    returns: string;
    prosecdef: boolean;
    proconfig: string[];
  }>`
    select pg_get_function_identity_arguments(oid) as args, pg_get_function_result(oid) as returns, prosecdef, proconfig
    from pg_proc where proname = 'erase_signer_pii'`.execute(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.args).toBe('p_github_id bigint, p_actor_github_id bigint, p_installation_id bigint');
  expect(rows[0]?.returns).toBe('integer');
  expect(rows[0]?.prosecdef).toBe(true);
  expect(rows[0]?.proconfig).toEqual([expect.stringMatching(/^search_path=.*, pg_catalog, pg_temp$/)]);
});

// A NULL proacl means "the default", which includes PUBLIC, so the ACL is not what to look at: ask the privilege check.
test('PUBLIC may not execute erasure (a function without the revoke would be callable by every role)', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ allowed: boolean; old: string | null }>`
    select has_function_privilege('public', 'erase_signer_pii(bigint, bigint, bigint)', 'execute') as allowed,
           to_regprocedure('erase_signer_pii(bigint, bigint)')::text as old`.execute(db);
  expect(rows).toEqual([{ allowed: false, old: null }]);
});
