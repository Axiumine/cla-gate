// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Role } from '../../domain/authz.ts';
import { ClaRuleError } from '../../services/cla-rule-error.ts';
import { type CommitOverrideDeps, createCommitOverride } from '../../services/commit-override-create.ts';
import { fakeEnqueuer, jobCount } from '../../services/jobs-fixture/test-support.ts';
import { installationRowIdSchema } from '../db/installation-row-id.ts';
import { COMMIT, overrideWorld, REASON, storedOverrides } from './commit-override-fixture/test-support.ts';
import { auditRows } from './document-fixture/test-support.ts';
import { pointAt, setEnabled } from './repository-document-fixture/test-support.ts';

// The service that records an override (E15-S05), called with no route in front of it: the checks it repeats under the lock of the
// repository, because the person waits for GitHub in between and the repository can change meanwhile (the route cannot show these: the
// guard has read the repository a moment before), and the repository it is not given. Every refusal stores nothing.

type World = Awaited<ReturnType<typeof overrideWorld>>;

/** A GitHub that has every commit, and runs `during` when it is asked, which is when the repository changes under the call. */
function githubThat(during: () => Promise<void>): CommitOverrideDeps['github'] {
  return {
    getCommit: async (_installation, _name, sha) => {
      await during();
      return { sha };
    },
  };
}

/** Calls the service as the org admin of tenant 1 (or as `role`) for `repositoryId`, with `during` run while GitHub is asked. */
function recordIn(
  world: World,
  repositoryId: number,
  during: () => Promise<void> = () => Promise.resolve(),
  role: Role = 'org_admin',
) {
  const { t1, people } = world;
  return createCommitOverride(
    { db: world.db, github: githubThat(during), enqueuer: fakeEnqueuer() },
    { installationId: installationRowIdSchema.parse(t1.installationId) },
    {
      repositoryId,
      role,
      actor: { id: people.admin1.userId, githubId: people.admin1.githubId, login: people.admin1.login },
      commitSha: COMMIT,
      reason: REASON,
    },
  );
}

const refusal = (work: Promise<unknown>) =>
  work.then(
    () => 'recorded',
    (error: unknown) => (error instanceof ClaRuleError ? error.rule : error),
  );

async function nothingStored(world: World): Promise<void> {
  expect(await storedOverrides(world)).toEqual([]);
  expect(await auditRows(world, 'commit_override.created')).toEqual([]);
  expect(await jobCount(world.db)).toBe(0);
}

test('a repository the tenant does not have is not_found, and GitHub is not asked', async () => {
  const world = await overrideWorld();
  let asked = false;
  const outcome = await refusal(
    recordIn(world, 987_654, () => {
      asked = true;
      return Promise.resolve();
    }),
  );
  expect([outcome, asked]).toEqual(['not_found', false]);
  await nothingStored(world);
});

test('a repository that GitHub stopped listing while the person waited is not_found, and nothing is stored', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const outcome = await refusal(
    recordIn(world, t1.plain.repositoryId, async () => {
      await world.db
        .updateTable('repositories')
        .set({ removed_at: new Date('2026-11-01T00:00:00Z') })
        .where('id', '=', t1.plain.repositoryId)
        .execute();
    }),
  );
  expect(outcome).toBe('not_found');
  await nothingStored(world);
});

test('a repository switched off while the person waited is repository_disabled, and nothing is stored', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const outcome = await refusal(
    recordIn(world, t1.plain.repositoryId, () => setEnabled(world, t1.plain.repositoryId, false)),
  );
  expect(outcome).toBe('repository_disabled');
  await nothingStored(world);
});

test("a document that changed while the person waited is judged again: the admin of a repository whose CLA became the organisation's is forbidden", async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const outcome = await refusal(
    recordIn(world, t1.scoped.repositoryId, () => pointAt(world, t1.scoped.repositoryId, t1.documentId), 'repo_admin'),
  );
  expect(outcome).toBe('forbidden');
  await nothingStored(world);
});

test('a second request for the commit that is stored while the person waited is override_exists, and the first row stays', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  const outcome = await refusal(
    recordIn(world, t1.plain.repositoryId, async () => {
      await world.db
        .insertInto('commit_overrides')
        .values({
          installation_id: t1.installationId,
          repository_id: t1.plain.repositoryId,
          commit_sha: COMMIT,
          created_by: people.admin2.userId,
          reason: 'the first reason',
        })
        .execute();
    }),
  );
  expect(outcome).toBe('override_exists');
  expect(await storedOverrides(world)).toMatchObject([
    { reason: 'the first reason', created_by: people.admin2.userId },
  ]);
  expect(await auditRows(world, 'commit_override.created')).toEqual([]);
});
