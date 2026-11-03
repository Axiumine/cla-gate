// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { pointAt, repositoryState, setEnabled } from './repository-document-fixture/test-support.ts';
import {
  enableAs,
  enabledAnswerOf,
  enabledAuditRows,
  enableWorld,
  readyScoped,
} from './repository-enable-fixture/test-support.ts';

// The cross-tenant checks of `POST /api/repositories/:repositoryId/enable` (E14-S03): the other tenant's repository, the admin of one
// repository against another repository of the installation, and what a change in one tenant does to the other.

/** Tenant 2's plain repository points at its published document, so that an org admin of tenant 2 can turn it on. */
async function readyTenantTwo(world: Awaited<ReturnType<typeof enableWorld>>): Promise<void> {
  await pointAt(world, world.t2.plain.repositoryId, world.t2.documentId);
}

test("the other tenant's repository id is 404 for either org admin, the answer for an id that exists nowhere, and no row of any tenant changes", async () => {
  const world = await enableWorld();
  await readyTenantTwo(world);
  const unknown = await enableAs(world, 'admin1', 987_654);
  const before = await tablesOf(world);
  const answers = [
    await enableAs(world, 'admin1', world.t2.plain.repositoryId),
    await enableAs(world, 'admin1', world.t2.scoped.repositoryId),
    await enableAs(world, 'admin2', world.t1.plain.repositoryId),
    await enableAs(world, 'admin2', world.t1.scoped.repositoryId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
  expect(await jobCount(world.db)).toBe(0);
});

test('the admin of repository X, whose CLA is its own, cannot turn on repository Y of the same installation: 403, and no row changes', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await readyScoped(world);
  const before = await tablesOf(world);
  const response = await enableAs(world, 'repoAdmin1', t1.plain.repositoryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
  expect(await tablesOf(world)).toEqual(before);
  const own = await enableAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect(enabledAnswerOf(own).changed).toBe(true);
  expect((await repositoryState(world, t1.plain.repositoryId)).enabled).toBe(false);
});

test('the admin of a repository gets 403 for a repository whose attached document covers the installation, unless they are also org admin', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.documentId);
  await setEnabled(world, t1.scoped.repositoryId, false);
  const refused = await enableAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
  const org = await enableAs(world, 'admin1', t1.scoped.repositoryId);
  expect(org.statusCode).toBe(200);
});

test('a change in one tenant writes its audit row under that tenant and sends a job for that tenant only, and touches no row of the other', async () => {
  const world = await enableWorld();
  const { t1, t2 } = world;
  await readyTenantTwo(world);
  const otherRepositories = await world.db
    .selectFrom('repositories')
    .selectAll()
    .where('installation_id', '=', t2.installationId)
    .orderBy('id')
    .execute();
  const otherAudit = await world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('installation_id', '=', t2.installationId)
    .orderBy('id')
    .execute();
  const response = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect(response.statusCode).toBe(200);
  expect((await enabledAuditRows(world, t1.plain.githubRepoId)).map((row) => row.installation_id)).toEqual([
    t1.installationId,
  ]);
  expect(
    await world.db
      .selectFrom('repositories')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherRepositories);
  expect(
    await world.db
      .selectFrom('audit_log')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherAudit);
  expect((await sentJobs(world.db)).map((sent) => sent.job)).toEqual([
    {
      type: 'sweep-repository',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.plain.githubRepoId,
      reason: 'repository_enabled',
    },
  ]);
});

test("each org admin turns on their own tenant's repository: one audit row and one job per tenant, each naming its own installation", async () => {
  const world = await enableWorld();
  const { t1, t2 } = world;
  await readyTenantTwo(world);
  const first = await enableAs(world, 'admin1', t1.plain.repositoryId);
  const second = await enableAs(world, 'admin2', t2.plain.repositoryId);
  expect([enabledAnswerOf(first).changed, enabledAnswerOf(second).changed]).toEqual([true, true]);
  expect((await enabledAuditRows(world, t2.plain.githubRepoId)).map((row) => row.installation_id)).toEqual([
    t2.installationId,
  ]);
  expect(
    (await sentJobs(world.db)).map((sent) => [
      sent.job.type,
      'githubInstallationId' in sent.job && sent.job.githubInstallationId,
    ]),
  ).toEqual([
    ['sweep-repository', t1.githubInstallationId],
    ['sweep-repository', t2.githubInstallationId],
  ]);
});
