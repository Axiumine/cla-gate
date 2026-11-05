// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { evaluationKey, type StoredEvaluationState } from '../../domain/sweep.ts';
import type { RepositoryScope } from '../close-pr/close-rows.ts';
import { batches } from '../repository-rows.ts';

// The rows of `pr_evaluations` the sweep reads (E07-S08). It writes none here: a row changes through the jobs it starts and through
// the cancellation of E07-S06 (the one column the sweep itself writes, `pr_state`, is in sweep-state-rows.ts). Every statement
// filters by the installation, so one tenant never reaches the rows of another.

/**
 * What is stored for each of the pull requests `prNumbers` of the repository, by {@link evaluationKey}: the row of every
 * head SHA the pull request was evaluated at, so the caller looks up the head SHA it has now. A pull request with no row has no entry.
 */
export async function evaluationStates(
  db: Kysely<Database>,
  scope: RepositoryScope,
  prNumbers: readonly number[],
): Promise<ReadonlyMap<string, StoredEvaluationState>> {
  const states = new Map<string, StoredEvaluationState>();
  for (const batch of batches(prNumbers)) {
    const rows = await db
      .selectFrom('pr_evaluations')
      .select(['pr_number', 'head_sha', 'result', 'updated_at'])
      .where('installation_id', '=', scope.installationId)
      .where('repository_id', '=', scope.repositoryId)
      .where('pr_number', 'in', batch)
      .execute();
    for (const row of rows) {
      states.set(evaluationKey(row.pr_number, row.head_sha), {
        result: row.result,
        updatedAtMs: row.updated_at.getTime(),
      });
    }
  }
  return states;
}

/** An evaluation that has been `in_progress` for too long. */
export interface StaleEvaluation {
  readonly id: number;
  readonly prNumber: number;
  readonly headSha: string;
}

/** The evaluations of the repository that are `in_progress` and were last touched before `cutoff`, oldest first. */
export async function staleEvaluations(
  db: Kysely<Database>,
  scope: RepositoryScope,
  cutoff: Date,
): Promise<StaleEvaluation[]> {
  const rows = await db
    .selectFrom('pr_evaluations')
    .select(['id', 'pr_number', 'head_sha'])
    .where('installation_id', '=', scope.installationId)
    .where('repository_id', '=', scope.repositoryId)
    .where('result', '=', 'in_progress')
    .where('updated_at', '<', cutoff)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({ id: row.id, prNumber: row.pr_number, headSha: row.head_sha }));
}
