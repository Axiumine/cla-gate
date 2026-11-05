// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Selectable, SelectQueryBuilder } from 'kysely';
import type { PendingReasonCode } from '../../shared/pending-prs.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { latestEvaluationPerPr } from './current-evaluation-queries.ts';
import { reasonCondition } from './pending-prs-reason.ts';

// The latest evaluation of each pull request, narrowed to the pending ones (E15-S07): open, failed and optionally with a reason. The
// installation is in the statement, so one tenant never reads the rows of another, whatever repository ids it is given.

/** The latest evaluation rows as a table named `latest`, to select from and join. */
export type PendingQuery = SelectQueryBuilder<
  Database & { latest: Selectable<Database['pr_evaluations']> },
  'latest',
  object
>;

/** The latest rows of the pull requests of `repositoryIds` that are open and failed, optionally narrowed to a reason, as a query to select from. */
export function pendingOf(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryIds: readonly number[],
  reason: PendingReasonCode | null,
): PendingQuery {
  const pending = db
    .selectFrom(latestEvaluationPerPr(db, scope.installationId, repositoryIds).as('latest'))
    .where('latest.result', '=', 'failure')
    .where('latest.pr_state', '=', 'open');
  return reason === null ? pending : pending.where((eb) => reasonCondition(eb.ref('latest.details'), reason));
}

/**
 * Up to `limit` of the repositories among `repositoryIds`, in the order of their id, that have at least one pending pull request (with a
 * reason of the given code, when one is given): the only ones worth a role lookup.
 */
export async function repositoriesWithPending(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryIds: readonly number[],
  narrow: { readonly reason: PendingReasonCode | null; readonly limit: number },
): Promise<number[]> {
  const rows = await pendingOf(db, scope, repositoryIds, narrow.reason)
    .select('latest.repository_id')
    .distinct()
    .orderBy('latest.repository_id')
    .limit(narrow.limit)
    .execute();
  return rows.map((row) => row.repository_id);
}
