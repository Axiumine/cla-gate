// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../shared/github-id.ts';
import { cancelRunning } from '../close-pr/cancel-running.ts';
import type { Closed } from '../close-pr/close-pr-ports.ts';
import { prunePullRequest } from '../close-pr/prune.ts';
import type { Tenant } from '../evaluate-pr/evaluation-facts.ts';
import type { GitHubPullRequestRef } from '../ports/github.ts';
import type { SweepContext, SweepPorts } from './sweep-ports.ts';
import type { StaleEvaluation } from './sweep-rows.ts';

// The reaper of the sweep (E07-S08): the evaluations that have been `in_progress` for more than 30 minutes belong to a job that
// was lost (a crash, a queue that dropped it, a reporter that never answered). The reaper settles each by what GitHub shows
// of its pull request now: closed, and the work is cleared the way a close does (E07-S06); open at the head SHA the row
// is for, and the evaluation is sent again, under the dedupe window of the sweep, by the same decision that treats every other pull request
// (a stale row is a pull request that needs one); open at another head SHA, and the row belongs to a superseded commit that
// nothing will finish, so its Check Run is reported cancelled and the row set `cancelled`, where it would be found again by
// every sweep.

/** The pull request as the close-pr job (E07-S06) is given it. */
function closedOf(tenant: Tenant, prNumber: number, currentHeadSha: string | undefined): Closed {
  return {
    githubInstallationId: parseGithubId(tenant.installation.github_installation_id),
    githubRepoId: parseGithubId(tenant.repository.github_repo_id),
    prNumber,
    resolved: { tenant, fullName: tenant.repository.full_name },
    currentHeadSha,
  };
}

/** What the reaper found of the pull requests the listing did not show. */
export interface UnlistedPulls {
  /** The pull requests that are still open, with the head SHA GitHub shows now (read one by one: they are past the listing). */
  readonly open: readonly GitHubPullRequestRef[];
  /** How many pull requests were found closed and cleared. */
  readonly closed: number;
}

/**
 * Asks GitHub for each pull request that has a stale evaluation and is not among the `listed` ones: it is closed, or it is
 * open and was beyond the pages the sweep reads. A closed one is cleared with {@link prunePullRequest}.
 * @throws what GitHub, the queue, the database or the reporter throws.
 */
export async function resolveUnlisted(
  ports: SweepPorts,
  context: SweepContext,
  tenant: Tenant,
  inputs: { readonly stale: readonly StaleEvaluation[]; readonly listed: ReadonlyMap<number, GitHubPullRequestRef> },
): Promise<UnlistedPulls> {
  const githubInstallationId = parseGithubId(tenant.installation.github_installation_id);
  const numbers = [...new Set(inputs.stale.map((row) => row.prNumber))].filter((number) => !inputs.listed.has(number));
  const open: GitHubPullRequestRef[] = [];
  let closed = 0;
  for (const prNumber of numbers) {
    const pr = await ports.github.getPullRequest(githubInstallationId, tenant.repository.full_name, prNumber);
    if (pr?.state === 'open') {
      open.push({ number: pr.number, state: 'open', headSha: pr.headSha });
    } else {
      await prunePullRequest(ports, context.pending, closedOf(tenant, prNumber, pr?.headSha));
      closed += 1;
    }
  }
  return { open, closed };
}

/**
 * Ends the stale evaluations of `open` pull requests that are for another head SHA than the one GitHub shows: reports the
 * Check Run `cancelled` and sets the row `cancelled` (see {@link cancelRunning}). A stale evaluation at the head SHA is left
 * alone, for the decision of the sweep.
 * @returns how many rows are now `cancelled`.
 */
export async function cancelSuperseded(
  ports: SweepPorts,
  tenant: Tenant,
  inputs: { readonly stale: readonly StaleEvaluation[]; readonly open: ReadonlyMap<number, GitHubPullRequestRef> },
): Promise<number> {
  let cancelled = 0;
  for (const row of inputs.stale) {
    const current = inputs.open.get(row.prNumber);
    if (current !== undefined && current.headSha !== row.headSha) {
      cancelled += await cancelRunning(ports, tenant.installation.id, closedOf(tenant, row.prNumber, current.headSha), [
        { id: row.id, headSha: row.headSha, result: 'in_progress' },
      ]);
    }
  }
  return cancelled;
}
