// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { RowAtSha } from '../../adapters/db/pr-evaluation-links.ts';
import type { RunTarget } from '../ports/reporter.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import type { Situation } from './report-situation.ts';

// The pull requests that share a head SHA with the one a report is about (E09-S05). The Check Run belongs to the SHA, so the rows
// of the other pull requests at it decide what the run says, but only the rows of pull requests that still stand at the SHA: a
// finished row of a pull request that was closed is never rewritten, and a pull request whose head moved on leaves its old row
// behind, so either would otherwise fail or hold the run of a pull request that is open and fine for good.

/**
 * The other pull requests whose rows decide the Check Run of the head SHA of `target`: the rows at the SHA of pull requests other
 * than the target's, left out when they are `cancelled` (a closed pull request counts for nothing), when the pull request has a
 * row touched later at another head SHA (it moved on), and when GitHub says the pull request is closed or its head is another
 * commit. A pull request GitHub does not list for the commit stays in, so a listing that misses a failing pull request never turns
 * its check green. GitHub is asked once, and only when a row is left to ask about.
 * @throws what the GitHub port throws.
 */
export async function liveSiblings(
  options: CheckRunReporterOptions,
  target: RunTarget,
  situation: Situation,
): Promise<readonly RowAtSha[]> {
  const candidates = situation.rows.filter(
    (row) => row.prNumber !== target.prNumber && row.result !== 'cancelled' && !row.superseded,
  );
  if (candidates.length === 0) {
    return [];
  }
  const pulls = await options.github.listPullRequestsForCommit(
    target.githubInstallationId,
    target.fullName,
    target.headSha,
  );
  const gone = new Set(
    pulls.filter((pull) => pull.state !== 'open' || pull.headSha !== target.headSha).map((pull) => pull.number),
  );
  return candidates.filter((row) => !gone.has(row.prNumber));
}
