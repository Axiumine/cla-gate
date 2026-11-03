// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { tenantChecksums } from '../adapters/db/tenant-fixture/test-support.ts';
import { publishVersion } from './cla-publish.ts';
import {
  dropJobs,
  droppingEnqueuer,
  failingAfterSend,
  jobCount,
  sentJobs,
  setJobStates,
} from './jobs-fixture/test-support.ts';
import {
  activeNumberOf,
  brokenBy,
  draftWith,
  publication,
  publishText,
  publishWorld,
} from './publish-fixture/test-support.ts';

// The jobs a new major version sends (E12-S04), through the fake queue, which writes into a test table on the transaction it is
// given: a job commits and rolls back with the version. One `sweep-repository` job with the reason `cla_version_published` goes to
// each repository of the tenant that is attached to the document, enabled and not removed; a minor version sends none.

type World = Awaited<ReturnType<typeof publishWorld>>;

/** Adds a repository of tenant 1 that is attached to `documentId` (or to nothing), with the state the test names. */
async function addRepository(
  world: World,
  githubRepoId: number,
  state: { documentId: number | null; enabled: boolean; removed?: boolean },
): Promise<void> {
  await world.db
    .insertInto('repositories')
    .values({
      installation_id: world.t1.installationId,
      github_repo_id: githubRepoId,
      full_name: `org-1/repo-${githubRepoId}`,
      enabled: state.enabled,
      cla_document_id: state.documentId,
      removed_at: state.removed === true ? new Date('2026-06-01T00:00:00Z') : null,
    })
    .execute();
}

/**
 * Tenant 1's repositories, around the installation-wide document: 9100 and 9101 enforce it; 9102 is attached and disabled, 9103 is
 * attached and removed, 9104 is enabled and attached to the other document, 9105 is enabled and attached to nothing. Tenant 2's
 * plain repository enforces tenant 2's document.
 */
async function arrangeRepositories(world: World): Promise<void> {
  await addRepository(world, 9100, { documentId: world.wide, enabled: true });
  await addRepository(world, 9101, { documentId: world.wide, enabled: true });
  await addRepository(world, 9102, { documentId: world.wide, enabled: false });
  await addRepository(world, 9103, { documentId: world.wide, enabled: true, removed: true });
  await addRepository(world, 9104, { documentId: world.scoped, enabled: true });
  await addRepository(world, 9105, { documentId: null, enabled: true });
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: world.t2.documentId, enabled: true })
    .where('id', '=', world.t2.plain.repositoryId)
    .execute();
}

test('a major version sends one sweep-repository job to each enabled repository attached to the document, keyed by version and repository, and to no other', async () => {
  const world = await publishWorld();
  await arrangeRepositories(world);
  const published = await publishText(world, world.wide, 'New wording\n', { acknowledgeResigning: true });
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `sweep-repository:cla_version_published:${published.version.id}:9100`,
      dedupeKey: null,
      coalesceKey: 'sweep-repository:9100',
      job: {
        type: 'sweep-repository',
        githubInstallationId: world.t1.githubInstallationId,
        githubRepoId: 9100,
        reason: 'cla_version_published',
      },
    },
    {
      idempotencyKey: `sweep-repository:cla_version_published:${published.version.id}:9101`,
      dedupeKey: null,
      coalesceKey: 'sweep-repository:9101',
      job: {
        type: 'sweep-repository',
        githubInstallationId: world.t1.githubInstallationId,
        githubRepoId: 9101,
        reason: 'cla_version_published',
      },
    },
  ]);
});

test('a job names the GitHub ids of the installation and of the repository, never the keys of our own tables', async () => {
  const world = await publishWorld();
  await arrangeRepositories(world);
  await publishText(world, world.wide, 'New wording\n', { acknowledgeResigning: true });
  const jobs = await sentJobs(world.db);
  expect(jobs.map(({ job }) => job)).not.toContainEqual(
    expect.objectContaining({ githubInstallationId: world.t1.installationId }),
  );
  expect(jobs).toHaveLength(2);
});

test('a minor version sends nothing: the signatures stay valid, so no pull request can change', async () => {
  const world = await publishWorld();
  await arrangeRepositories(world);
  await publishText(world, world.wide, 'Typo fixed\n', { bump: 'minor' });
  expect(await sentJobs(world.db)).toEqual([]);
  expect(world.enqueuer.calls).toEqual([]);
});

test('the first version of a document is a major one and sends its jobs too', async () => {
  const world = await publishWorld();
  await addRepository(world, 9200, { documentId: world.scoped, enabled: true });
  await publishText(world, world.scoped, 'First terms\n');
  expect((await sentJobs(world.db)).map(({ job }) => job)).toMatchObject([
    { type: 'sweep-repository', githubRepoId: 9200, reason: 'cla_version_published' },
  ]);
});

test('a document no repository enforces sends nothing, and the publish succeeds', async () => {
  const world = await publishWorld();
  const published = await publishText(world, world.wide, 'New wording\n', { acknowledgeResigning: true });
  expect(published.version.major).toBe(2);
  expect(world.enqueuer.calls).toEqual([]);
});

test('a second major version while the first sweep still waits sends none: that run reads the newer policy when it starts', async () => {
  const world = await publishWorld();
  await addRepository(world, 9300, { documentId: world.wide, enabled: true });
  const first = await publishText(world, world.wide, 'Second major\n', { acknowledgeResigning: true });
  await publishText(world, world.wide, 'Third major\n');
  expect((await sentJobs(world.db)).map((sent) => sent.idempotencyKey)).toEqual([
    `sweep-repository:cla_version_published:${first.version.id}:9300`,
  ]);
  expect(world.enqueuer.calls).toHaveLength(2);
});

test('a second major version after the first sweep has started sends another: the running sweep may have read the first policy', async () => {
  const world = await publishWorld();
  await addRepository(world, 9300, { documentId: world.wide, enabled: true });
  const first = await publishText(world, world.wide, 'Second major\n', { acknowledgeResigning: true });
  await setJobStates(world.db, 'active');
  const second = await publishText(world, world.wide, 'Third major\n');
  expect((await sentJobs(world.db)).map((sent) => sent.idempotencyKey)).toEqual([
    `sweep-repository:cla_version_published:${first.version.id}:9300`,
    `sweep-repository:cla_version_published:${second.version.id}:9300`,
  ]);
  expect(world.enqueuer.calls.every((call) => call.options.dedupeKey === undefined)).toBe(true);
});

test('a publish that is refused sends nothing', async () => {
  const world = await publishWorld();
  await arrangeRepositories(world);
  const revision = await draftWith(world, world.wide, 'New wording\n');
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.wide, { source: { type: 'draft', revision } }),
    ),
  );
  expect(outcome?.rule).toBe('resign_confirmation_required');
  expect(world.enqueuer.calls).toEqual([]);
  expect(await jobCount(world.db)).toBe(0);
});

test.each([
  ['a queue that fails before it sends', { enqueue: () => Promise.reject(new Error('queue down')) }],
  ['a queue that sends and then loses its connection', undefined],
] as const)(
  '%s fails the publish: no version row, no audit row, the pointer and the draft as they were, and no job',
  async (_label, failing) => {
    const world = await publishWorld();
    await arrangeRepositories(world);
    const revision = await draftWith(world, world.wide, 'New wording\n');
    const before = await tenantChecksums(world.db);
    const enqueuer = failing ?? failingAfterSend(world.enqueuer, new Error('queue down'));
    await expect(
      publishVersion(
        world.db,
        world.scope,
        enqueuer,
        await publication(world, world.wide, { source: { type: 'draft', revision }, acknowledgeResigning: true }),
      ),
    ).rejects.toThrow('queue down');
    expect(await tenantChecksums(world.db)).toEqual(before);
    expect(await activeNumberOf(world.db, world.wide)).toBe('1.0');
    expect(await jobCount(world.db)).toBe(0);
  },
);

test('a retry after the queue came back publishes, and sends each job once', async () => {
  const world = await publishWorld();
  await arrangeRepositories(world);
  const revision = await draftWith(world, world.wide, 'New wording\n');
  const request = await publication(world, world.wide, {
    source: { type: 'draft', revision },
    acknowledgeResigning: true,
  });
  await expect(
    publishVersion(world.db, world.scope, failingAfterSend(world.enqueuer, new Error('queue down')), request),
  ).rejects.toThrow('queue down');
  await dropJobs(world.db);
  const published = await publishVersion(world.db, world.scope, world.enqueuer, request);
  expect(published.version.major).toBe(2);
  expect(await jobCount(world.db)).toBe(2);
});

test('whatever the queue answers to a send, the publish stands: a job already waiting or dropped does not undo a version', async () => {
  const world = await publishWorld();
  await arrangeRepositories(world);
  const revision = await draftWith(world, world.wide, 'New wording\n');
  const published = await publishVersion(
    world.db,
    world.scope,
    droppingEnqueuer,
    await publication(world, world.wide, { source: { type: 'draft', revision }, acknowledgeResigning: true }),
  );
  expect(published.version.major).toBe(2);
  expect(await activeNumberOf(world.db, world.wide)).toBe('2.0');
});
