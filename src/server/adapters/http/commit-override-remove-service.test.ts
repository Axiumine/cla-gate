// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Role } from '../../domain/authz.ts';
import { ClaRuleError } from '../../services/cla-rule-error.ts';
import { removeCommitOverride } from '../../services/commit-override-remove.ts';
import { fakeEnqueuer, jobCount } from '../../services/jobs-fixture/test-support.ts';
import { installationRowIdSchema } from '../db/installation-row-id.ts';
import { overrideIdOf, overridesIn, overrideWorld, SEEDED_COMMIT } from './commit-override-fixture/test-support.ts';
import { auditRows } from './document-fixture/test-support.ts';
import { pointAt } from './repository-document-fixture/test-support.ts';

// The service that removes an override (E15-S06), called with no route in front of it: the checks it makes under the lock of the
// repository, because the guard has read the role and the repository a moment before and either can change in between (the route cannot
// show these). Every refusal deletes nothing, writes no audit row and sends no job.

type World = Awaited<ReturnType<typeof overrideWorld>>;

/** Calls the service as the person with `role` for the override `overrideId` of the repository `repositoryId` of tenant 1. */
function removeIn(world: World, target: { repositoryId: number; overrideId: number }, role: Role = 'org_admin') {
  return removeCommitOverride(
    { db: world.db, enqueuer: fakeEnqueuer() },
    { installationId: installationRowIdSchema.parse(world.t1.installationId) },
    { ...target, role, actorGithubId: world.people.admin1.githubId },
  );
}

const refusal = (work: Promise<unknown>) =>
  work.then(
    () => 'removed',
    (error: unknown) => (error instanceof ClaRuleError ? error.rule : error),
  );

async function nothingRemoved(world: World, repositoryId: number, id: number): Promise<void> {
  expect(await overridesIn(world, repositoryId)).toEqual([[id, SEEDED_COMMIT]]);
  expect(await auditRows(world, 'commit_override.deleted')).toEqual([]);
  expect(await jobCount(world.db)).toBe(0);
}

test('a repository the tenant does not have is not_found, and the override of the other repository stays', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  expect(await refusal(removeIn(world, { repositoryId: 987_654, overrideId: id }))).toBe('not_found');
  await nothingRemoved(world, t1.plain.repositoryId, id);
});

test('a repository that GitHub stopped listing after the guard read it is not_found, and nothing is removed', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-11-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect(await refusal(removeIn(world, { repositoryId: t1.plain.repositoryId, overrideId: id }))).toBe('not_found');
  await nothingRemoved(world, t1.plain.repositoryId, id);
});

test("a document that changed after the guard read the role is judged again under the lock: the admin of a repository whose CLA became the organisation's is forbidden", async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await world.db
    .insertInto('commit_overrides')
    .values({
      installation_id: t1.installationId,
      repository_id: t1.scoped.repositoryId,
      commit_sha: SEEDED_COMMIT,
      created_by: world.people.admin1.userId,
      reason: 'the scoped repository',
    })
    .execute();
  const id = await overrideIdOf(world, t1.scoped.repositoryId, SEEDED_COMMIT);
  await pointAt(world, t1.scoped.repositoryId, t1.documentId);
  expect(await refusal(removeIn(world, { repositoryId: t1.scoped.repositoryId, overrideId: id }, 'repo_admin'))).toBe(
    'forbidden',
  );
  await nothingRemoved(world, t1.scoped.repositoryId, id);
  expect(await refusal(removeIn(world, { repositoryId: t1.scoped.repositoryId, overrideId: id }))).toBe('removed');
});

test('an override the repository does not have is not_found after the role was judged, and an override of the sibling repository is not removed through this one', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  expect(await refusal(removeIn(world, { repositoryId: t1.scoped.repositoryId, overrideId: id }))).toBe('not_found');
  expect(await refusal(removeIn(world, { repositoryId: t1.plain.repositoryId, overrideId: 987_654 }))).toBe(
    'not_found',
  );
  await nothingRemoved(world, t1.plain.repositoryId, id);
});
