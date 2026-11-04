// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { REPOSITORY_ENABLE_PATH, repositoryEnabledResponseSchema } from '../../../../shared/repository-enabled.ts';
import { createJobsTable, fakeEnqueuer, type SentJob, sentJobs } from '../../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { auditRows, type DocumentWorld, documentWorld, parsed } from '../document-fixture/test-support.ts';
import { pointAt, publish, setEnabled } from '../repository-document-fixture/test-support.ts';

// The helpers of the tests of `POST /api/repositories/:repositoryId/enable` (E14-S03), on the world of the documents tests: two
// tenants, five people, the real app on PGlite, and a fake queue that writes into a test table on the transaction it is given.
// Tenant 1 has the plain repository `org-1/repo` (GitHub id 9000, installation 5000) and `org-1/scoped`, and the installation-wide
// document `Individual CLA` (published) and `Repository CLA` (scoped to `org-1/scoped`, not published); tenant 2 has the same.

/** The path of the switch of the repository `repositoryId` (`repositories.id`). */
export const enablePath = (repositoryId: number | string): string =>
  REPOSITORY_ENABLE_PATH.replace(':repositoryId', String(repositoryId));

/** Turns enforcement on for a repository as `who`; `body` is sent as the body (an empty object unless given). */
export function enableAs(
  world: DocumentWorld,
  who: PersonName | null,
  repositoryId: number | string,
  body: object = {},
) {
  return world.ask(who, { method: 'POST', url: enablePath(repositoryId), payload: body });
}

/** The answer of a call that succeeded, read with the shared schema. */
export const enabledAnswerOf = (response: { json: () => unknown }) => parsed(response, repositoryEnabledResponseSchema);

/**
 * A world whose queue is `enqueuer` (the fake one unless given), in which the plain repository of tenant 1 is off and points at the
 * published installation-wide document, so an org admin can turn it on.
 */
export async function enableWorld(enqueuer: JobEnqueuer = fakeEnqueuer()) {
  const world = await documentWorld({ enqueuer });
  await createJobsTable(world.db);
  await pointAt(world, world.t1.plain.repositoryId, world.t1.documentId);
  return world;
}

/** The scoped repository of tenant 1 off and pointing at its own published document: the admin of that repository can turn it on. */
export async function readyScoped(world: DocumentWorld): Promise<void> {
  const { scoped } = world.t1;
  await publish(world, scoped.documentId);
  await pointAt(world, scoped.repositoryId, scoped.documentId);
  await setEnabled(world, scoped.repositoryId, false);
}

/** The `repository.enabled` audit rows a call wrote for the repository with GitHub id `githubRepoId`, oldest first (the world seeds one of its own). */
export async function enabledAuditRows(world: DocumentWorld, githubRepoId: number) {
  return (await auditRows(world, 'repository.enabled')).filter((row) => row.subject_id === githubRepoId);
}

/** The `sweep-repository` jobs sent so far. */
export async function sweeps(world: DocumentWorld): Promise<SentJob[]> {
  return (await sentJobs(world.db)).filter((sent) => sent.job.type === 'sweep-repository');
}
