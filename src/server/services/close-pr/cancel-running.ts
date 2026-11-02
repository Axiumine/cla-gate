// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Closed, ClosePrPorts } from './close-pr-ports.ts';
import { cancelEvaluation, type PullRequestEvaluation } from './close-rows.ts';

// The evaluations of a closed pull request that are still in progress, ended (E07-S06).

/**
 * For each of `evaluations` still `in_progress`, reports its Check Run `cancelled` and then sets the row to `cancelled`.
 * The report comes first, so a failure of it leaves the row `in_progress` and the retry of the job finds it again; both are
 * idempotent. Evaluations with a final result are untouched.
 * @returns how many rows are now `cancelled` (one that got its verdict in the meantime keeps it and is not counted).
 */
export async function cancelRunning(
  ports: ClosePrPorts,
  installationId: InstallationRowId,
  closed: Closed,
  evaluations: readonly PullRequestEvaluation[],
): Promise<number> {
  let cancelled = 0;
  for (const evaluation of evaluations.filter((stored) => stored.result === 'in_progress')) {
    await ports.reporter.cancelled({
      githubInstallationId: closed.githubInstallationId,
      githubRepoId: closed.githubRepoId,
      fullName: closed.resolved.fullName,
      prNumber: closed.prNumber,
      headSha: evaluation.headSha,
      evaluationId: evaluation.id,
    });
    if (await cancelEvaluation(ports.db, installationId, evaluation.id)) {
      cancelled += 1;
    }
  }
  return cancelled;
}
