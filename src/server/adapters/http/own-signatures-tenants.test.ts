// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { failureOf, ownSignaturesWorld, pageOf } from './own-signatures-fixture/test-support.ts';

// The list of a person's own signatures across people and tenants (E13-S06). Two people, 1 and 2, sign in both tenants, made by
// `seedTenant(db, 1)` and `seedTenant(db, 2)`. The person is the one of the session and nothing in the request can change it.

/** Users 1 and 2 with a session each, and signatures of both in both tenants, newest at the end. */
async function twoPeopleInTwoTenants() {
  const world = await ownSignaturesWorld();
  const [one, two] = [await world.login(1), await world.login(2)];
  const ids = {
    oneInT1: (await seedSignatures(world.db, world.t1, [{ githubId: 1, signedAtMs: 1000 }]))[0],
    twoInT1: (await seedSignatures(world.db, world.t1, [{ githubId: 2, signedAtMs: 2000 }]))[0],
    oneInT2: (await seedSignatures(world.db, world.t2, [{ githubId: 1, signedAtMs: 3000 }]))[0],
    twoInT2: (await seedSignatures(world.db, world.t2, [{ githubId: 2, signedAtMs: 4000 }]))[0],
  };
  return { world, one, two, ids };
}

test('user 1 sees exactly their own rows from both tenants and none of user 2, and user 2 the opposite', async () => {
  const { world, one, two, ids } = await twoPeopleInTwoTenants();
  const seenByOne = pageOf(await world.list(one)).items;
  expect(seenByOne.map((item) => item.id)).toEqual([ids.oneInT2, ids.oneInT1]);
  expect(seenByOne.map((item) => item.installation.accountLogin)).toEqual(['org-2', 'org-1']);
  const seenByTwo = pageOf(await world.list(two)).items;
  expect(seenByTwo.map((item) => item.id)).toEqual([ids.twoInT2, ids.twoInT1]);
});

test('a request that names the other person is a 400 and gets nothing of either, whatever the key', async () => {
  const { world, one, two } = await twoPeopleInTwoTenants();
  for (const query of [
    '?userId=2',
    '?githubId=2',
    `?userId=${two.userId}`,
    `?githubId=${two.githubId}`,
    '?login=login-2',
  ]) {
    const response = await world.list(one, query);
    expect(failureOf(response), query).toEqual([400, 'bad_request']);
    expect(response.body, query).not.toContain('org-');
  }
});

test('a person who signed in one tenant only sees that tenant, and the other tenant is not named', async () => {
  const { world, one } = await twoPeopleInTwoTenants();
  const three = await world.login(3);
  const [made] = await seedSignatures(world.db, world.t2, [{ githubId: 3, signedAtMs: 5000 }]);
  const response = await world.list(three);
  expect(pageOf(response).items.map((item) => item.id)).toEqual([made]);
  expect(response.body).not.toContain('org-1');
  expect(pageOf(await world.list(one)).items.map((item) => item.id)).not.toContain(made);
});

test('the signature of a person who has the same login in the snapshot is not listed: the key is the numeric id of the session', async () => {
  const { world, one, ids } = await twoPeopleInTwoTenants();
  await world.db
    .updateTable('users')
    .set({ login: 'login-1' })
    .where('github_id', '=', 2)
    .execute()
    .catch(() => undefined);
  const items = pageOf(await world.list(one)).items;
  expect(items.map((item) => item.id)).toEqual([ids.oneInT2, ids.oneInT1]);
});

test('an item names no person: no name, address or login of the signer, no reason of a revocation and nobody who revoked', async () => {
  const world = await ownSignaturesWorld();
  const ada = await world.login(1234);
  await seedSignatures(world.db, world.t1, [
    {
      githubId: 1234,
      pii: { login: 'zzzz-login', name: 'Zzzz Name', email: 'zzzz@example.test' },
      signedAtMs: 1000,
      revoked: { afterMs: 500, byGithubId: 4321, reason: 'legal_request' },
    },
  ]);
  const response = await world.list(ada);
  const [item, ...others] = pageOf(response).items;
  expect(others).toHaveLength(0);
  // The keys are the whole of what an item says; the revoker's id (a number, which a substring search cannot tell from any other) has no key.
  expect(new Set(Object.keys(item ?? {}))).toEqual(
    new Set(['document', 'id', 'installation', 'resignPath', 'revokedAt', 'signedAt', 'source', 'state', 'version']),
  );
  for (const marker of ['zzzz', 'Zzzz', 'legal_request', 'revokeReason', 'revoke_reason', 'revokedBy', 'revoked_by']) {
    expect(response.body, marker).not.toContain(marker);
  }
});
