// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { finaliseRepository } from '../../services/finalise/finalise-repository.ts';
import { fakeEnqueuer, jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { captureLogs } from '../../test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { createLogger } from './logger.ts';
import {
  disableAs,
  disabledAnswerOf,
  disabledAuditRows,
  disableWorld,
  finalisations,
} from './repository-disable-fixture/test-support.ts';
import { pointAt, repositoryState, setEnabled } from './repository-document-fixture/test-support.ts';

// The cross-tenant checks of `POST /api/repositories/:repositoryId/disable` (E14-S04): the other tenant's repository, the admin of one
// repository against another repository of the installation, and what a disable in one tenant sends and does to the other, down to the
// jobs that follow it. The two tenants' pull requests have the same numbers and head SHAs (the fixture of `twoTenants`).

test("the other tenant's repository id is 404 for either org admin, the answer for an id that exists nowhere, and no row of any tenant changes", async () => {
  const world = await disableWorld();
  await setEnabled(world, world.t2.plain.repositoryId, true);
  const unknown = await disableAs(world, 'admin1', 987_654);
  const before = await tablesOf(world);
  const answers = [
    await disableAs(world, 'admin1', world.t2.plain.repositoryId),
    await disableAs(world, 'admin1', world.t2.scoped.repositoryId),
    await disableAs(world, 'admin2', world.t1.plain.repositoryId),
    await disableAs(world, 'admin2', world.t1.scoped.repositoryId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
  expect(await jobCount(world.db)).toBe(0);
});

test('the admin of repository X, whose CLA is its own, cannot turn off repository Y of the same installation: 403, and no row changes', async () => {
  const world = await disableWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const before = await tablesOf(world);
  const response = await disableAs(world, 'repoAdmin1', t1.plain.repositoryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
  expect(await tablesOf(world)).toEqual(before);
  const own = await disableAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect(disabledAnswerOf(own).changed).toBe(true);
  expect((await repositoryState(world, t1.plain.repositoryId)).enabled).toBe(true);
});

test('a change in one tenant writes its audit row under that tenant and sends a job for that tenant only, and touches no row of the other', async () => {
  const world = await disableWorld();
  const { t1, t2 } = world;
  await setEnabled(world, t2.plain.repositoryId, true);
  const rowsOfTenantTwo = async () => ({
    repositories: await world.db
      .selectFrom('repositories')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
    audit: await world.db
      .selectFrom('audit_log')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
    evaluations: await world.db
      .selectFrom('pr_evaluations')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  });
  const was = await rowsOfTenantTwo();
  const response = await disableAs(world, 'admin1', t1.plain.repositoryId);
  expect(response.statusCode).toBe(200);
  expect((await disabledAuditRows(world, t1.plain.githubRepoId)).map((row) => row.installation_id)).toEqual([
    t1.installationId,
  ]);
  expect(await rowsOfTenantTwo()).toEqual(was);
  expect((await sentJobs(world.db)).map((sent) => sent.job)).toEqual([
    { type: 'finalise-repository', githubInstallationId: t1.githubInstallationId, githubRepoId: t1.plain.githubRepoId },
  ]);
});

test('disabling tenant 1 sends no finalise-check for tenant 2 even though both have pull request 8 at the same head SHA, in progress', async () => {
  const world = await disableWorld();
  const { t1, t2 } = world;
  await setEnabled(world, t2.plain.repositoryId, true);
  const evaluationsOf = (installationId: number) =>
    world.db
      .selectFrom('pr_evaluations')
      .select(['pr_number', 'head_sha', 'result'])
      .where('installation_id', '=', installationId)
      .where('result', '=', 'in_progress')
      .execute();
  expect(await evaluationsOf(t1.installationId)).toEqual(await evaluationsOf(t2.installationId));
  await disableAs(world, 'admin1', t1.plain.repositoryId);
  const [sent] = await finalisations(world);
  if (sent?.job.type !== 'finalise-repository') {
    throw new Error('no finalise-repository job was sent');
  }
  const queue = fakeEnqueuer();
  const outcome = await finaliseRepository({ db: world.db }, sent.job, {
    logger: createLogger({ logLevel: 'info' }, captureLogs().destination),
    enqueuer: queue,
    jobId: 'job-1',
  });
  expect(outcome).toEqual({ outcome: 'queued' });
  expect(queue.calls.map((call) => call.job)).toEqual([
    {
      type: 'finalise-check',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.plain.githubRepoId,
      prNumber: 8,
    },
  ]);
  expect((await repositoryState(world, t2.plain.repositoryId)).enabled).toBe(true);
});

test("an envelope that pairs tenant 2's installation with tenant 1's repository finds no repository and sends nothing", async () => {
  const world = await disableWorld();
  const { t1, t2 } = world;
  await disableAs(world, 'admin1', t1.plain.repositoryId);
  await setEnabled(world, t2.plain.repositoryId, false);
  const queue = fakeEnqueuer();
  const outcome = await finaliseRepository(
    { db: world.db },
    { type: 'finalise-repository', githubInstallationId: t2.githubInstallationId, githubRepoId: t1.plain.githubRepoId },
    { logger: createLogger({ logLevel: 'silent' }), enqueuer: queue, jobId: 'job-1' },
  );
  expect(outcome).toEqual({ outcome: 'skipped:repository_not_found' });
  expect(queue.calls).toEqual([]);
});
