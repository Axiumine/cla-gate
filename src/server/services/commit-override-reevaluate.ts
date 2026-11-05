// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql, type Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { OVERRIDDEN_COMMIT_PATH, overriddenCommitVars } from '../domain/affected-prs.ts';
import { enqueueAffectedPrs } from './affected-prs.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The pull requests a removed override can change (E15-S06), in the transaction of the removal: split from commit-override-remove.ts,
// which keeps the rules of the removal itself.

/**
 * Sends the jobs that evaluate again the open pull requests of the repository that the removed override had turned green: those whose
 * latest result is a success and whose stored details (E08) list the commit as waived by an override. The override is not matched by its
 * id, so a result that rests on an earlier override of the same commit, which a job has not yet replaced, is evaluated again too. Every
 * other result of the repository is left alone: a failure cannot become worse, and a success that rests on no override cannot change.
 * @returns how many jobs were asked for.
 */
export function reevaluateAfterRemoval(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  removed: { readonly repositoryId: number; readonly overrideId: number; readonly commitSha: string },
): Promise<number> {
  return enqueueAffectedPrs(trx, enqueuer, scope, {
    repositoryIds: [removed.repositoryId],
    result: 'success',
    detailsMatch: (details) =>
      sql<boolean>`jsonb_path_exists(${details}, ${OVERRIDDEN_COMMIT_PATH}::jsonpath, ${overriddenCommitVars(removed.commitSha)}::jsonb)`,
    action: { reason: 'override_changed', change: `deleted:${String(removed.overrideId)}` },
    trigger: 'policy_change',
  });
}
