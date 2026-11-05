// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { COMMIT_OVERRIDES_PATH, commitOverrideResponseSchema } from '../../../../shared/commit-override.ts';
import type { CommitGitHub } from '../../../services/commit-override-lookup.ts';
import { createJobsTable, fakeEnqueuer, type SentJob, sentJobs } from '../../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import type { PersonName, TenantWorld } from '../../db/tenant-fixture/test-support.ts';
import { MATRIX_COMMIT_SHA } from '../cross-tenant-prepare/test-support.ts';
import { type DocumentWorld, documentWorld, parsed } from '../document-fixture/test-support.ts';

// The helpers of the tests of `POST /api/repositories/:repositoryId/commit-overrides` (E15-S05), on the world of the documents tests:
// two tenants, five people, the real app on PGlite, a fake queue that writes into a test table on the transaction it is given, and
// the fake GitHub the commits are looked up on. Both tenants' plain repositories (`org-1/repo`, GitHub id 9000, and `org-2/repo`) are on
// and enforce their tenant's installation-wide document; the scoped repositories (`org-N/scoped`) are on and enforce their own.
// The GitHub of the world has the commit `COMMIT` in all four repositories, and the world stores an override of `SEEDED_COMMIT` in
// each plain repository.

/** A commit every repository of the world has on GitHub (`MATRIX_COMMIT_SHA`), which no override of the world covers. */
export const COMMIT = MATRIX_COMMIT_SHA;

/** The commit the world stores an override of, in the plain repository of each tenant. */
export const SEEDED_COMMIT = 'a'.repeat(40);

/** The reason most tests send. */
export const REASON = 'The author email is not linked to a GitHub account.';

/** The path of the overrides of the repository `repositoryId` (`repositories.id`). */
const overridesPath = (repositoryId: number | string): string =>
  COMMIT_OVERRIDES_PATH.replace(':repositoryId', String(repositoryId));

/** The body most tests send for `commitSha`. */
export const bodyOf = (commitSha: string, reason = REASON): { commitSha: string; reason: string } => ({
  commitSha,
  reason,
});

/**
 * The world of the override tests: the documents world with a queue (the fake one unless given), its jobs table, and both tenants'
 * repositories on, each enforcing the document that covers it. `commitGitHub` replaces the GitHub the commit is looked up on, and
 * `undefined` given explicitly leaves the app with its own default (no GitHub App).
 */
export async function overrideWorld(
  options: { readonly enqueuer?: JobEnqueuer; readonly commitGitHub?: CommitGitHub | undefined } = {},
) {
  const { enqueuer = fakeEnqueuer() } = options;
  const world = await documentWorld({
    enqueuer,
    ...('commitGitHub' in options ? { commitGitHub: options.commitGitHub } : {}),
  });
  await createJobsTable(world.db);
  for (const tenant of [world.t1, world.t2]) {
    await world.db
      .updateTable('repositories')
      .set({ enabled: true, cla_document_id: tenant.documentId })
      .where('id', '=', tenant.plain.repositoryId)
      .execute();
    await world.db
      .updateTable('repositories')
      .set({ enabled: true, cla_document_id: tenant.scoped.documentId })
      .where('id', '=', tenant.scoped.repositoryId)
      .execute();
  }
  return world;
}

/** Records an override as `who` in the repository `repositoryId`; `body` is sent as it is. */
export function recordWith(world: DocumentWorld, who: PersonName | null, repositoryId: number | string, body: object) {
  return world.ask(who, { method: 'POST', url: overridesPath(repositoryId), payload: body });
}

/** Records an override of `commitSha` with the usual reason as `who`. */
export function recordAs(
  world: DocumentWorld,
  who: PersonName | null,
  repositoryId: number | string,
  commitSha: string,
) {
  return recordWith(world, who, repositoryId, bodyOf(commitSha));
}

/** The override of a `201`, read with the shared schema. */
export const overrideOf = (response: { json: () => unknown }) =>
  parsed(response, commitOverrideResponseSchema).override;

/** Every row of `commit_overrides` but the ones the world seeds, oldest first. */
export function storedOverrides(world: DocumentWorld) {
  return world.db
    .selectFrom('commit_overrides')
    .selectAll()
    .where('commit_sha', '<>', SEEDED_COMMIT)
    .orderBy('id')
    .execute();
}

/** The calls the fake GitHub served to look a commit up. */
export const lookups = (world: DocumentWorld) => world.fakeGitHub.calls.filter((call) => call.method === 'getCommit');

/** The jobs sent so far that are of `type`. */
export async function jobsOf(world: DocumentWorld, type: 'evaluate-pr' | 'sweep-repository'): Promise<SentJob[]> {
  return (await sentJobs(world.db)).filter((sent) => sent.job.type === type);
}

/**
 * Gives the repository `repositoryId` of the tenant `installationId` a pull request for each number in `numbers`, whose latest
 * evaluation is `result` and whose state is `state`, past the routes. The head SHA of the pull request `n` is `n` as 40 hex digits.
 */
export async function evaluatedPullRequests(
  world: DocumentWorld,
  target: { readonly installationId: number; readonly repositoryId: number },
  spec: {
    readonly numbers: readonly number[];
    readonly result: 'in_progress' | 'success' | 'failure';
    readonly state?: 'open' | 'closed';
  },
): Promise<void> {
  await world.db
    .insertInto('pr_evaluations')
    .values(
      spec.numbers.map((prNumber) => ({
        installation_id: target.installationId,
        repository_id: target.repositoryId,
        pr_number: prNumber,
        head_sha: prNumber.toString(16).padStart(40, '0'),
        result: spec.result,
        pr_state: spec.state ?? 'open',
      })),
    )
    .execute();
}

/** The plain repository of `tenant`, as the helpers above name a repository. */
export const plainOf = (tenant: TenantWorld) => ({
  installationId: tenant.installationId,
  repositoryId: tenant.plain.repositoryId,
});

/** The scoped repository of `tenant`. */
export const scopedOf = (tenant: TenantWorld) => ({
  installationId: tenant.installationId,
  repositoryId: tenant.scoped.repositoryId,
});

/** One evaluation of a pull request at a head, as it was left at `updatedAt`, past the routes: the newest one of a pull request is its latest. */
export async function storeEvaluation(
  world: DocumentWorld,
  target: { readonly installationId: number; readonly repositoryId: number },
  evaluation: {
    readonly prNumber: number;
    readonly head: number;
    readonly result: 'success' | 'failure';
    readonly updatedAt: string;
  },
): Promise<void> {
  await world.db
    .insertInto('pr_evaluations')
    .values({
      installation_id: target.installationId,
      repository_id: target.repositoryId,
      pr_number: evaluation.prNumber,
      head_sha: evaluation.head.toString(16).padStart(40, '0'),
      result: evaluation.result,
      updated_at: new Date(evaluation.updatedAt),
    })
    .execute();
}
