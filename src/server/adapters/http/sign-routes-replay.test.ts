// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { contextOf, repoIdOf, signWorld } from './sign-context-fixture/test-support.ts';
import {
  ADA_EMAIL,
  bodyFor,
  postSign,
  publishNext,
  signedOf,
  signerWith,
  signingWorld,
  writtenRows,
} from './sign-fixture/test-support.ts';

// The repeat of a sign request (E13-S04): the partial unique index `signatures_active_unique` allows one signature that is not
// revoked for a person, a document and a major version, so a second request for it writes nothing and answers with the
// signature that exists. The same outcome under real concurrency is in sign-routes-race.test.ts.

const ONE_OF_EACH = { signatures: 1, signerPii: 1, audit: 1 } as const;

test('a double submit is a 200 with created false and the existing signature, and writes no second row of any table', async () => {
  const { world, ada, body } = await signingWorld();
  const first = signedOf(await postSign(world, ada, body()), 201);
  const second = signedOf(await postSign(world, ada, body()), 200);
  expect(second).toEqual({ signature: first.signature, created: false });
  expect(await writtenRows(world.db)).toEqual(ONE_OF_EACH);
});

test('a repeat neither overwrites the stored name and address nor adds a job', async () => {
  const enqueuer = fakeEnqueuer();
  const world = await signWorld({}, { enqueuer });
  const ada = await signerWith(world, 1234, [ADA_EMAIL, { email: 'ada@example.net', primary: false }]);
  const before = bodyFor(world.t1, 1);
  signedOf(await postSign(world, ada, before), 201);
  const stored = await world.db.selectFrom('signer_pii').selectAll().executeTakeFirstOrThrow();
  const repeat = bodyFor(world.t1, 1, { name: 'Someone Else', email: 'ada@example.net', prNumber: 99 });
  signedOf(await postSign(world, ada, repeat), 200);
  expect(await world.db.selectFrom('signer_pii').selectAll().execute()).toEqual([stored]);
  expect(stored).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.org' });
  const row = await world.db.selectFrom('signatures').select('source_pr_number').executeTakeFirstOrThrow();
  expect(row.source_pr_number).toBe(45);
  expect(enqueuer.calls).toEqual([]);
});

test('signing a minor version of a major the person already signed returns the old signature, made under the old version', async () => {
  const { world, ada, body } = await signingWorld();
  const first = signedOf(await postSign(world, ada, body()), 201);
  const next = await publishNext(world, 1, 1);
  const again = signedOf(await postSign(world, ada, body({ versionId: next.id, contentSha256: next.sha })), 200);
  expect(again).toEqual({ signature: first.signature, created: false });
  expect(again.signature).toMatchObject({ versionId: world.t1.versionId, major: 1, minor: 0 });
  expect(await writtenRows(world.db)).toEqual(ONE_OF_EACH);
});

test('a new major version needs a new signature: 201, a second row, and the first one stays', async () => {
  const { world, ada, body } = await signingWorld();
  const first = signedOf(await postSign(world, ada, body()), 201);
  const next = await publishNext(world, 2, 0);
  const second = signedOf(await postSign(world, ada, body({ versionId: next.id, contentSha256: next.sha })), 201);
  expect(second.signature).toMatchObject({ versionId: next.id, major: 2, minor: 0 });
  expect(second.signature.id).not.toBe(first.signature.id);
  const rows = await world.db
    .selectFrom('signatures')
    .select(['id', 'major', 'content_sha256', 'revoked_at'])
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    { id: first.signature.id, major: 1, content_sha256: world.t1.contentSha256, revoked_at: null },
    { id: second.signature.id, major: 2, content_sha256: next.sha, revoked_at: null },
  ]);
  expect(await writtenRows(world.db)).toEqual({ signatures: 2, signerPii: 2, audit: 2 });
  expect(contextOf(await world.ask(ada, repoIdOf(1))).signature).toMatchObject({ id: second.signature.id, major: 2 });
});

test('a person whose earlier signature was revoked signs again: 201, a new row, and the revoked row is untouched', async () => {
  const { world, ada, body } = await signingWorld();
  const first = signedOf(await postSign(world, ada, body()), 201);
  // The revoke route is E15; a direct update by the owner role stands in for it.
  await world.db
    .updateTable('signatures')
    .set({
      revoked_at: new Date(Date.now() + 1000),
      revoked_by: world.t1.publisherId,
      revoke_reason: 'maintainer_decision',
    })
    .where('id', '=', first.signature.id)
    .execute();
  const revoked = await world.db
    .selectFrom('signatures')
    .selectAll()
    .where('id', '=', first.signature.id)
    .executeTakeFirstOrThrow();
  const second = signedOf(await postSign(world, ada, body()), 201);
  expect(second.signature.id).not.toBe(first.signature.id);
  expect(
    await world.db.selectFrom('signatures').selectAll().where('id', '=', first.signature.id).executeTakeFirstOrThrow(),
  ).toEqual(revoked);
  const live = await world.db.selectFrom('signatures').select('id').where('revoked_at', 'is', null).execute();
  expect(live).toEqual([{ id: second.signature.id }]);
  expect(await writtenRows(world.db)).toEqual({ signatures: 2, signerPii: 2, audit: 2 });
});

test('ten identical requests one after the other give one 201 and nine 200, and one row of signatures, signer_pii and audit', async () => {
  const { world, ada, body } = await signingWorld();
  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) {
    statuses.push((await postSign(world, ada, body())).statusCode);
  }
  expect(statuses).toEqual([201, ...Array.from({ length: 9 }, () => 200)]);
  expect(await writtenRows(world.db)).toEqual(ONE_OF_EACH);
});

test('ten requests with different names one after the other give the same outcome, and the first name is the one stored', async () => {
  const { world, ada, body } = await signingWorld();
  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) {
    statuses.push((await postSign(world, ada, body({ name: `Ada ${i}` }))).statusCode);
  }
  expect(statuses).toEqual([201, ...Array.from({ length: 9 }, () => 200)]);
  expect(await writtenRows(world.db)).toEqual(ONE_OF_EACH);
  expect((await world.db.selectFrom('signer_pii').select('name').executeTakeFirstOrThrow()).name).toBe('Ada 0');
});
