// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { REPOSITORY_DISABLE_PATH, repositoryEnabledResponseSchema } from '../../../../shared/repository-enabled.ts';
import { fakeEnqueuer, type SentJob, sentJobs } from '../../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { auditRows, type DocumentWorld, parsed } from '../document-fixture/test-support.ts';
import { setEnabled } from '../repository-document-fixture/test-support.ts';
import { enableWorld } from '../repository-enable-fixture/test-support.ts';

// The helpers of the tests of `POST /api/repositories/:repositoryId/disable` (E14-S04), on the world of the enable tests: two
// tenants, five people, the real app on PGlite and a fake queue that writes into a test table on the transaction it is given.
// Tenant 1's plain repository `org-1/repo` enforces the published installation-wide document here, so an org admin can turn it off;
// `org-1/scoped` enforces nothing of its own (no document attached) and is on.

/** The path of the switch of the repository `repositoryId` (`repositories.id`). */
export const disablePath = (repositoryId: number | string): string =>
  REPOSITORY_DISABLE_PATH.replace(':repositoryId', String(repositoryId));

/** Turns enforcement off for a repository as `who`; `body` is sent as the body (an empty object unless given). */
export function disableAs(
  world: DocumentWorld,
  who: PersonName | null,
  repositoryId: number | string,
  body: object = {},
) {
  return world.ask(who, { method: 'POST', url: disablePath(repositoryId), payload: body });
}

/** The answer of a call that succeeded, read with the shared schema. */
export const disabledAnswerOf = (response: { json: () => unknown }) =>
  parsed(response, repositoryEnabledResponseSchema);

/** A world whose queue is `enqueuer` (the fake one unless given) and in which the plain repository of tenant 1 is on. */
export async function disableWorld(enqueuer: JobEnqueuer = fakeEnqueuer()) {
  const world = await enableWorld(enqueuer);
  await setEnabled(world, world.t1.plain.repositoryId, true);
  return world;
}

/** The `repository.disabled` audit rows a call wrote for the repository with GitHub id `githubRepoId`, oldest first. */
export async function disabledAuditRows(world: DocumentWorld, githubRepoId: number) {
  return (await auditRows(world, 'repository.disabled')).filter((row) => row.subject_id === githubRepoId);
}

/** The `finalise-repository` jobs sent so far. */
export async function finalisations(world: DocumentWorld): Promise<SentJob[]> {
  return (await sentJobs(world.db)).filter((sent) => sent.job.type === 'finalise-repository');
}
