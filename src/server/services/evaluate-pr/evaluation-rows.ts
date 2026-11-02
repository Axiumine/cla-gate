// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Database } from '../../adapters/db/schema.ts';

// The rows of `pr_evaluations` the evaluation job writes (E07-S04): `result` and `details`. The two columns of the reporter
// (`check_run_id`, `comment_id`, E09-S04) are read here and never written, and the upsert keeps them. Every statement
// filters by the installation, so one tenant never reaches the rows of another.

/** One pull request at one head SHA of one repository of an installation: the unique key of the table, with its tenant. */
export interface EvaluationKey {
  /** `installations.id`. */
  readonly installationId: InstallationRowId;
  /** `repositories.id`. */
  readonly repositoryId: number;
  readonly prNumber: number;
  readonly headSha: string;
}

/** What the job needs to know of a stored evaluation. */
export interface StoredEvaluation {
  readonly id: number;
  readonly result: 'in_progress' | 'success' | 'failure';
  readonly checkRunId: number | null;
}

/** The evaluation stored for `key`, or `null`. */
export async function findEvaluation(db: Kysely<Database>, key: EvaluationKey): Promise<StoredEvaluation | null> {
  const row = await db
    .selectFrom('pr_evaluations')
    .select(['id', 'result', 'check_run_id'])
    .where('installation_id', '=', key.installationId)
    .where('repository_id', '=', key.repositoryId)
    .where('pr_number', '=', key.prNumber)
    .where('head_sha', '=', key.headSha)
    .executeTakeFirst();
  return row === undefined ? null : { id: row.id, result: row.result, checkRunId: row.check_run_id };
}

/**
 * Sets the evaluation of `key` to `in_progress` with empty details, creating the row when there is none: one statement, so
 * a retry, or two jobs of one pull request, leave one row. A row that exists keeps its reporter columns and its id.
 * @returns the id of the row.
 */
export async function startEvaluation(db: Kysely<Database>, key: EvaluationKey): Promise<number> {
  const row = await db
    .insertInto('pr_evaluations')
    .values({
      installation_id: key.installationId,
      repository_id: key.repositoryId,
      pr_number: key.prNumber,
      head_sha: key.headSha,
      result: 'in_progress',
      details: '{}',
    })
    .onConflict((conflict) =>
      conflict
        .columns(['repository_id', 'pr_number', 'head_sha'])
        .doUpdateSet({ result: 'in_progress', details: '{}', updated_at: sql`now()` })
        .where('pr_evaluations.installation_id', '=', key.installationId),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Stores the verdict and the details of the evaluation `evaluationId` of the installation. @throws when the installation has no such row. */
export async function finishEvaluation(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  evaluationId: number,
  details: PrEvaluationDetails,
): Promise<void> {
  await db
    .updateTable('pr_evaluations')
    .set({ result: details.outcome, details: JSON.stringify(details), updated_at: sql`now()` })
    .where('installation_id', '=', installationId)
    .where('id', '=', evaluationId)
    .returning('id')
    .executeTakeFirstOrThrow();
}
