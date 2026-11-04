// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_LOG_PATH, auditLogPageSchema } from '../../../shared/audit-log.ts';
import { insertSignature, storePii } from '../db/erasure-fixture/test-support.ts';
import type { PersonName } from '../db/tenant-fixture/test-support.ts';
import { dataChecksums, erasureWorld } from './erasure-fixture/test-support.ts';

// The erasure and the tenants (E16-S04): a person who signed in two orgs is erased for the org whose admin asked and stays a
// signer of the other, an admin reaches only the data of their own installation, and the audit row of an erasure is the
// tenant's own. `member1` signs in tenant 1 (GitHub id 31004); the world here has them sign in tenant 2 as well.

const MEMBER1 = 31_004;

/** The world with `member1` also a signer in tenant 2, with the personal data held for that signature. */
async function worldWithSharedSigner() {
  const world = await erasureWorld();
  const signatureId = await insertSignature(world.db, world.t2, world.t1.signer);
  await storePii(world.db, signatureId, world.t1.signer);
  return { ...world, tenant2SignatureId: signatureId };
}

/** The audit rows `signer_pii.erased` of a tenant as its admin reads them. */
async function erasedRows(
  world: Awaited<ReturnType<typeof worldWithSharedSigner>>,
  who: PersonName,
  installationId: number,
) {
  const response = await world.ask(who, {
    method: 'GET',
    url: `${AUDIT_LOG_PATH.replace(':installationId', String(installationId))}?action=signer_pii.erased`,
  });
  expect(response.statusCode).toBe(200);
  return auditLogPageSchema.parse(response.json()).items;
}

test('erasing through tenant 1 deletes what tenant 1 holds and leaves tenant 2 its rows, the display snapshot and the session of the person', async () => {
  const world = await worldWithSharedSigner();
  const { erase, preview, ask, db, t1, t2, tenant2SignatureId } = world;

  expect((await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 })).json()).toEqual({
    erasedRows: 1,
  });

  const rows = await db
    .selectFrom('signer_pii')
    .select('signature_id')
    .where('user_id', '=', t1.signer.userId)
    .execute();
  expect(rows).toEqual([{ signature_id: tenant2SignatureId }]);
  expect((await preview('admin2', t2.installationId, `?githubUserId=${MEMBER1}`)).json()).toEqual({
    githubUserId: MEMBER1,
    signatures: 1,
    signerPiiRows: 1,
    allowlistEntries: 0,
  });
  expect((await preview('admin1', t1.installationId, `?githubUserId=${MEMBER1}`)).json()).toEqual({
    githubUserId: MEMBER1,
    signatures: 1,
    signerPiiRows: 0,
    allowlistEntries: 0,
  });
  const user = await db
    .selectFrom('users')
    .select(['login', 'name'])
    .where('github_id', '=', MEMBER1)
    .executeTakeFirstOrThrow();
  expect(user).toEqual({ login: t1.signer.login, name: 'Name 31004' });
  expect((await ask('member1', { method: 'GET', url: '/api/auth/session' })).statusCode).toBe(200);
});

test('erasing through tenant 2 as well scrubs the snapshot and ends the session, once no tenant holds personal data of the person', async () => {
  const { erase, ask, db, t1, t2 } = await worldWithSharedSigner();
  await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });

  expect((await erase('admin2', t2.installationId, { githubUserId: MEMBER1, expectedRows: 1 })).json()).toEqual({
    erasedRows: 1,
  });

  const user = await db
    .selectFrom('users')
    .select(['login', 'name', 'avatar_url'])
    .where('github_id', '=', MEMBER1)
    .executeTakeFirstOrThrow();
  expect(user).toEqual({ login: 'erased-31004', name: null, avatar_url: null });
  expect((await ask('member1', { method: 'GET', url: '/api/auth/session' })).statusCode).toBe(401);
});

test("an admin of tenant 1 reaches nothing of tenant 2 through tenant 2's path: both routes are the 404 of an unknown id and nothing changes", async () => {
  const { erase, preview, db, t1, t2, people } = await worldWithSharedSigner();
  const before = await dataChecksums(db);
  const unknown = await preview('admin1', 987_654, `?githubUserId=${MEMBER1}`);
  for (const githubUserId of [MEMBER1, people.admin2.githubId]) {
    const seen = await preview('admin1', t2.installationId, `?githubUserId=${githubUserId}`);
    const erased = await erase('admin1', t2.installationId, { githubUserId, expectedRows: 1 });
    expect([seen.statusCode, erased.statusCode]).toEqual([404, 404]);
    expect(seen.body.replace(/"requestId":"[^"]+"/, '')).toBe(unknown.body.replace(/"requestId":"[^"]+"/, ''));
  }
  expect(await dataChecksums(db)).toEqual(before);
  const user = await db.selectFrom('users').select('login').where('github_id', '=', MEMBER1).executeTakeFirstOrThrow();
  expect(user.login).toBe(t1.signer.login);
});

test("the admin of tenant 2 learns nothing of the erasure through tenant 1: the audit row is tenant 1's, and tenant 1's path is a 404 for them", async () => {
  const world = await worldWithSharedSigner();
  const { erase, ask, t1, t2 } = world;
  await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });

  expect(await erasedRows(world, 'admin2', t2.installationId)).toEqual([]);
  const crossed = await ask('admin2', {
    method: 'GET',
    url: `${AUDIT_LOG_PATH.replace(':installationId', String(t1.installationId))}?action=signer_pii.erased`,
  });
  expect(crossed.statusCode).toBe(404);
  expect(await erasedRows(world, 'admin1', t1.installationId)).toEqual([
    expect.objectContaining({
      action: 'signer_pii.erased',
      actor: { githubId: 31_001, login: 'login-31001' },
      subject: { type: 'user', id: MEMBER1 },
      metadata: { signer_pii_rows: 1 },
    }),
  ]);
});

test("the audit row of an erasure is written once for the installation of the path, and a second tenant's own erasure adds its own", async () => {
  const world = await worldWithSharedSigner();
  const { erase, t1, t2 } = world;
  await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });
  await erase('admin2', t2.installationId, { githubUserId: MEMBER1, expectedRows: 1 });

  expect((await erasedRows(world, 'admin1', t1.installationId)).map((row) => row.subject)).toEqual([
    { type: 'user', id: MEMBER1 },
  ]);
  expect((await erasedRows(world, 'admin2', t2.installationId)).map((row) => row.actor)).toEqual([
    { githubId: 31_002, login: 'login-31002' },
  ]);
});
