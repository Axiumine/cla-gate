// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  listOverridesAs,
  overrideWorld,
  pageOf,
  SEEDED_COMMIT,
  scopedOf,
  seedOverrides,
  shaOf,
} from './commit-override-fixture/test-support.ts';
import { tablesOf, withoutRequestId } from './document-fixture/test-support.ts';

// The cross-tenant checks of GET /api/repositories/:repositoryId/commit-overrides (E15-S06): the other tenant's repository, and the same
// commit overridden in both tenants. The matrix of E11-S06 holds the role cases.

test("the list of a tenant never holds the other tenant's rows, even for an identical commit: each plain repository stores an override of the same SHA", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const stored = await world.db
    .selectFrom('commit_overrides as o')
    .innerJoin('users as u', 'u.id', 'o.created_by')
    .select(['o.id', 'o.installation_id', 'o.commit_sha', 'u.github_id'])
    .where('o.commit_sha', '=', SEEDED_COMMIT)
    .orderBy('o.id')
    .execute();
  expect(stored.map((row) => row.installation_id)).toEqual([t1.installationId, t2.installationId]);
  const first = pageOf(await listOverridesAs(world, 'admin1', t1.plain.repositoryId));
  const second = pageOf(await listOverridesAs(world, 'admin2', t2.plain.repositoryId));
  expect(first.items.map((item) => [item.id, item.commitSha])).toEqual([[stored[0]?.id, SEEDED_COMMIT]]);
  expect(second.items.map((item) => [item.id, item.commitSha])).toEqual([[stored[1]?.id, SEEDED_COMMIT]]);
  expect(first.items[0]?.createdBy.githubId).toBe(stored[0]?.github_id);
  expect(second.items[0]?.createdBy.githubId).toBe(stored[1]?.github_id);
  expect(first.items[0]?.createdBy.githubId).not.toBe(second.items[0]?.createdBy.githubId);
});

test("an override of the other tenant's scoped repository with its own commit is not listed under this tenant's, and each tenant reads only its own", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  await seedOverrides(world, scopedOf(t1), [{ commitSha: shaOf(1), createdAt: '2026-10-01T10:00:00Z' }]);
  await seedOverrides(world, scopedOf(t2), [
    { commitSha: shaOf(1), createdAt: '2026-10-02T10:00:00Z', reason: 'tenant two' },
    { commitSha: shaOf(2), createdAt: '2026-10-03T10:00:00Z', reason: 'tenant two' },
  ]);
  const own = pageOf(await listOverridesAs(world, 'admin1', t1.scoped.repositoryId));
  const other = pageOf(await listOverridesAs(world, 'admin2', t2.scoped.repositoryId));
  expect(own.items.map((item) => item.commitSha)).toEqual([shaOf(1)]);
  expect(own.items.map((item) => item.reason)).not.toContain('tenant two');
  expect(other.items.map((item) => item.commitSha)).toEqual([shaOf(2), shaOf(1)]);
});

test("the other tenant's repository id is 404 for either org admin and for the admin of a repository, the answer for an id that exists nowhere, and no row changes", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const unknown = await listOverridesAs(world, 'admin1', 987_654);
  const before = await tablesOf(world);
  const answers = [
    await listOverridesAs(world, 'admin1', t2.plain.repositoryId),
    await listOverridesAs(world, 'admin1', t2.scoped.repositoryId),
    await listOverridesAs(world, 'admin2', t1.plain.repositoryId),
    await listOverridesAs(world, 'admin2', t1.scoped.repositoryId),
    await listOverridesAs(world, 'repoAdmin1', t2.scoped.repositoryId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
});
