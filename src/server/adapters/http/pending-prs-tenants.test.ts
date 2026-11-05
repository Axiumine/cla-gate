// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { plainOf, scopedOf } from './commit-override-fixture/test-support.ts';
import { namesOf, pageOf, pendingWorld, storeEvaluations } from './pending-prs-fixture/test-support.ts';

// The pending pull requests and the tenants (E15-S07): every statement names the installation of the path, so a pull request of another
// tenant never comes back, whoever asks and whatever the filters say.

test('the failing pull requests of tenant 2 never appear for the admin of tenant 1, the same number and the same head SHA included, and the reverse', async () => {
  const world = await pendingWorld();
  const { pending, t1, t2 } = world;
  // The same pull request number at the same head SHA in both tenants, and one number each.
  await storeEvaluations(world, plainOf(t1), [
    { prNumber: 5, head: 9 },
    { prNumber: 6, head: 9 },
  ]);
  await storeEvaluations(world, plainOf(t2), [
    { prNumber: 5, head: 9 },
    { prNumber: 8, head: 9 },
  ]);
  await storeEvaluations(world, scopedOf(t2), [{ prNumber: 5, head: 9 }]);
  const first = await pending('admin1', t1.installationId);
  const second = await pending('admin2', t2.installationId);
  expect(namesOf(first)).toEqual(expect.arrayContaining(['org-1/repo#5', 'org-1/repo#6']));
  expect(namesOf(first).filter((name) => !name.startsWith('org-1/'))).toEqual([]);
  expect(namesOf(second).sort((a, b) => a.localeCompare(b))).toEqual([
    'org-2/repo#5',
    'org-2/repo#8',
    'org-2/scoped#5',
  ]);
  expect(first.body).not.toContain('org-2');
  expect(second.body).not.toContain('org-1');
});

test("the list of the same pull request number in both tenants holds each tenant's own row, with its own ids", async () => {
  const world = await pendingWorld();
  const { pending, t1, t2 } = world;
  const [inOne] = await storeEvaluations(world, plainOf(t1), [{ prNumber: 5, head: 9 }]);
  const [inTwo] = await storeEvaluations(world, plainOf(t2), [{ prNumber: 5, head: 9 }]);
  expect(pageOf(await pending('admin1', t1.installationId)).items.map((item) => item.evaluationId)).toContain(inOne);
  expect(pageOf(await pending('admin1', t1.installationId)).items.map((item) => item.evaluationId)).not.toContain(
    inTwo,
  );
  expect(pageOf(await pending('admin2', t2.installationId)).items.map((item) => item.evaluationId)).toEqual([inTwo]);
});

test('an admin of both tenants sees each tenant only under its own path, and a repository of the other one is still a 404', async () => {
  const world = await pendingWorld();
  const { pending, people, roles, roleTable, t1, t2 } = world;
  const both = { login: people.admin1.login, userId: people.admin1.githubId, role: 'admin' } as const;
  roles.load({ ...roleTable, orgs: [...roleTable.orgs, { ...both, installation: t2.githubInstallationId }] });
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5 }]);
  await storeEvaluations(world, plainOf(t2), [{ prNumber: 5 }]);
  expect(namesOf(await pending('admin1', t1.installationId))).toEqual(['org-1/repo#5']);
  expect(namesOf(await pending('admin1', t2.installationId))).toEqual(['org-2/repo#5']);
  expect((await pending('admin1', t1.installationId, `?repositoryId=${t2.plain.repositoryId}`)).statusCode).toBe(404);
  expect((await pending('admin1', t2.installationId, `?repositoryId=${t1.plain.repositoryId}`)).statusCode).toBe(404);
});

test('the same GitHub user uncovered in both tenants is listed in each under its own path, and the filters keep the tenants apart', async () => {
  const world = await pendingWorld();
  const { pending, t1, t2 } = world;
  const details = { codes: ['unsigned_contributor' as const], actors: [{ githubId: t1.signer.githubId }] };
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5, details }]);
  await storeEvaluations(world, plainOf(t2), [{ prNumber: 6, details }]);
  const query = '?reason=unsigned_contributor';
  expect(namesOf(await pending('admin1', t1.installationId, query))).toEqual(['org-1/repo#5']);
  expect(namesOf(await pending('admin2', t2.installationId, query))).toEqual(['org-2/repo#6']);
});

test('a repository admin of tenant 1 sees nothing of tenant 2 whatever tenant 2 holds', async () => {
  const world = await pendingWorld();
  const { pending, t1, t2 } = world;
  await storeEvaluations(world, scopedOf(t2), [{ prNumber: 5 }]);
  expect(pageOf(await pending('repoAdmin1', t1.installationId)).items).toEqual([]);
  expect((await pending('repoAdmin1', t2.installationId)).statusCode).toBe(404);
});
