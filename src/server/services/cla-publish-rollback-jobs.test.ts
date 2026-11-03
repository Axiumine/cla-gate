// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { tenantChecksums } from '../adapters/db/tenant-fixture/test-support.ts';
import { publishVersion } from './cla-publish.ts';
import { failingAfterSend, jobCount, sentJobs } from './jobs-fixture/test-support.ts';
import { activeNumberOf, publication, publishText, publishWorld } from './publish-fixture/test-support.ts';

// The jobs a rollback sends (E12-S06): the rule of a publish (E12-S04) applies to a copy as it does to a draft. A major rollback
// sends one `sweep-repository` job to each enabled repository attached to the document, keyed by the NEW version and the
// repository; a minor one sends none; a queue that fails undoes the whole rollback.

type World = Awaited<ReturnType<typeof publishWorld>>;

/** Makes the plain repository of tenant 1 enforce the installation-wide document, which has the version 1.0 and then 1.1 (minor). */
async function enforcedHistory(world: World): Promise<{ v11: number }> {
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: world.wide, enabled: true })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  const minor = await publishText(world, world.wide, 'Edit inside the first major\n', { bump: 'minor' });
  return { v11: minor.version.id };
}

test('a minor rollback sends nothing: the signatures stay valid, so no pull request can change', async () => {
  const world = await publishWorld();
  await enforcedHistory(world);
  await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await publication(world, world.wide, { source: { type: 'version', versionId: world.t1.versionId }, bump: 'minor' }),
  );
  expect(await activeNumberOf(world.db, world.wide)).toBe('1.2');
  expect(world.enqueuer.calls).toEqual([]);
  expect(await jobCount(world.db)).toBe(0);
});

test('a major rollback sends one sweep-repository job to the enforcing repository, keyed by the new version and the repository', async () => {
  const world = await publishWorld();
  const { v11 } = await enforcedHistory(world);
  const published = await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await publication(world, world.wide, {
      source: { type: 'version', versionId: v11 },
      acknowledgeResigning: true,
    }),
  );
  expect(published.version.id).not.toBe(v11);
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `sweep-repository:cla_version_published:${published.version.id}:${world.t1.plain.githubRepoId}`,
      dedupeKey: null,
      coalesceKey: `sweep-repository:${world.t1.plain.githubRepoId}`,
      job: {
        type: 'sweep-repository',
        githubInstallationId: world.t1.githubInstallationId,
        githubRepoId: world.t1.plain.githubRepoId,
        reason: 'cla_version_published',
      },
    },
  ]);
});

test('a rollback that is refused sends nothing', async () => {
  const world = await publishWorld();
  const { v11 } = await enforcedHistory(world);
  await expect(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.wide, { source: { type: 'version', versionId: v11 } }),
    ),
  ).rejects.toMatchObject({ rule: 'resign_confirmation_required' });
  expect(world.enqueuer.calls).toEqual([]);
});

test('a queue that fails after it sent fails the rollback: no version row, no audit row, the pointer as it was, and no job', async () => {
  const world = await publishWorld();
  const { v11 } = await enforcedHistory(world);
  const before = await tenantChecksums(world.db);
  await expect(
    publishVersion(
      world.db,
      world.scope,
      failingAfterSend(world.enqueuer, new Error('queue down')),
      await publication(world, world.wide, {
        source: { type: 'version', versionId: v11 },
        bump: 'major',
        acknowledgeResigning: true,
      }),
    ),
  ).rejects.toThrow('queue down');
  expect(await tenantChecksums(world.db)).toEqual(before);
  expect(await activeNumberOf(world.db, world.wide)).toBe('1.1');
  expect(await jobCount(world.db)).toBe(0);
});
