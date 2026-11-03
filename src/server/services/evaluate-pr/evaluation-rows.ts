// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Database } from '../../adapters/db/schema.ts';

// The rows of `pr_evaluations` the evaluation job writes (E07-S04): `result` and `details`; the dead-letter handler writes
// `failure` with a code (E07-S05). The two columns of the reporter
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

/** The result a row holds: the two verdicts of the engine and the two states of the lifecycle (`cancelled` is E07-S06's). */
export type StoredResult = Database['pr_evaluations']['result'];

/** What the job needs to know of a stored evaluation. */
export interface StoredEvaluation {
  readonly id: number;
  readonly result: StoredResult;
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

/**
 * The details of a row whose evaluation could not be completed (E07-S05): a code and nothing else, so no contributor is
 * named and no field of the engine's schema is claimed. Readers that do not know the code show it as `other`.
 */
const FAILED_DETAILS = JSON.stringify({ code: 'evaluation_failed' });

/**
 * What {@link failEvaluation} does with a row that already holds a verdict: `keep` leaves a `success`, a `cancelled` and a
 * `failure` with its reasons as they are (a dead job that comes late must not undo what another run concluded), `replace`
 * turns them to the dead-letter failure (the re-run of a Check Run that died fails closed: its report is the failure).
 */
export type FinalVerdict = 'keep' | 'replace';

/**
 * Sets the evaluation of `key` to `failure` with the details `{ "code": "evaluation_failed" }`, creating the row when
 * there is none (E07-S05): the dead-letter handler's write, one statement, so a retry of the handler leaves one row. A row
 * that exists keeps its reporter columns and its id. A row with no result yet (`in_progress`) or that this write made itself is
 * always changed; one with another verdict is changed only with `replace` (see {@link FinalVerdict}).
 * @returns the id of the row, or `null` when the row holds a verdict that was kept.
 */
export async function failEvaluation(
  db: Kysely<Database>,
  key: EvaluationKey,
  finalVerdict: FinalVerdict,
): Promise<number | null> {
  const row = await db
    .insertInto('pr_evaluations')
    .values({
      installation_id: key.installationId,
      repository_id: key.repositoryId,
      pr_number: key.prNumber,
      head_sha: key.headSha,
      result: 'failure',
      details: FAILED_DETAILS,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['repository_id', 'pr_number', 'head_sha'])
        .doUpdateSet({ result: 'failure', details: FAILED_DETAILS, updated_at: sql`now()` })
        .where('pr_evaluations.installation_id', '=', key.installationId)
        .where(
          sql<boolean>`(${finalVerdict === 'replace'} or pr_evaluations.result = 'in_progress' or pr_evaluations.details = ${FAILED_DETAILS}::jsonb)`,
        ),
    )
    .returning('id')
    .executeTakeFirst();
  return row?.id ?? null;
}

/** The rows of the repository of an installation at one head SHA, one per pull request that was evaluated at it, oldest first. */
export async function evaluationsAtHead(
  db: Kysely<Database>,
  tenant: { readonly installationId: InstallationRowId; readonly repositoryId: number },
  headSha: string,
): Promise<{ readonly id: number; readonly prNumber: number }[]> {
  const rows = await db
    .selectFrom('pr_evaluations')
    .select(['id', 'pr_number'])
    .where('installation_id', '=', tenant.installationId)
    .where('repository_id', '=', tenant.repositoryId)
    .where('head_sha', '=', headSha)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({ id: row.id, prNumber: row.pr_number }));
}
