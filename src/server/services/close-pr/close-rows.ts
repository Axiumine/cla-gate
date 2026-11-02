// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { StoredResult } from '../evaluate-pr/evaluation-rows.ts';

// The rows of `pr_evaluations` the handler of a closed pull request reads and writes (E07-S06). Every statement filters by
// the installation, so one tenant never reaches the rows of another.

/** The repository of an installation: both row ids, as the job loaded them. */
export interface RepositoryScope {
  /** `installations.id`. */
  readonly installationId: InstallationRowId;
  /** `repositories.id`. */
  readonly repositoryId: number;
}

/** One stored evaluation of a pull request: the row, the head SHA it was made at and where it stands. */
export interface PullRequestEvaluation {
  readonly id: number;
  readonly headSha: string;
  readonly result: StoredResult;
}

/** Every evaluation stored for the pull request, one per head SHA it was evaluated at, oldest first. */
export async function evaluationsOfPullRequest(
  db: Kysely<Database>,
  scope: RepositoryScope,
  prNumber: number,
): Promise<PullRequestEvaluation[]> {
  const rows = await db
    .selectFrom('pr_evaluations')
    .select(['id', 'head_sha', 'result'])
    .where('installation_id', '=', scope.installationId)
    .where('repository_id', '=', scope.repositoryId)
    .where('pr_number', '=', prNumber)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({ id: row.id, headSha: row.head_sha, result: row.result }));
}

/**
 * Sets the evaluation `evaluationId` of the installation to `cancelled`, if it is still in progress: a row that got its
 * verdict in the meantime is left as it is. One statement, so a second close finds nothing to do.
 * @returns whether the row changed.
 */
export async function cancelEvaluation(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  evaluationId: number,
): Promise<boolean> {
  const row = await db
    .updateTable('pr_evaluations')
    .set({ result: 'cancelled', updated_at: sql`now()` })
    .where('installation_id', '=', installationId)
    .where('id', '=', evaluationId)
    .where('result', '=', 'in_progress')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}
