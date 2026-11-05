// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../shared/github-id.ts';
import { evaluationKey, needsSweepEvaluation, STALE_AFTER_SECONDS } from '../../domain/sweep.ts';
import type { Tenant } from '../evaluate-pr/evaluation-facts.ts';
import type { GitHubPullRequestRef } from '../ports/github.ts';
import { listOpenPulls } from './open-pulls.ts';
import { cancelSuperseded, resolveUnlisted } from './reaper.ts';
import { enqueueEvaluations, type SendCounts, SWEEP_REQUEST } from './sweep-enqueue.ts';
import type { SweepContext, SweepPorts } from './sweep-ports.ts';
import { evaluationStates, staleEvaluations } from './sweep-rows.ts';
import { reconcilePullRequestStates } from './sweep-state-rows.ts';

// The sweep of one repository (E07-S08): the open pull requests are read, the ones with no final result for their head SHA are
// sent to be evaluated, and the evaluations that stayed `in_progress` are settled by the reaper. A listing that was read to its
// last page also corrects `pr_state` where a close or a reopen was missed (E15-S01), last, after every send, and only for the
// pull requests GitHub confirms one by one: the listing alone is not the truth, because pull requests close while its pages are read.

/** What the sweep of one repository did: counts only, for the log of the job. */
export interface RepositorySweep extends SendCounts {
  /** Open pull requests read. */
  readonly listed: number;
  /** True when the repository has more open pull requests than the sweep reads in one run. */
  readonly truncated: boolean;
  /** Pull requests with a stale evaluation that were found closed and cleared. */
  readonly closed: number;
  /** Stale evaluations of superseded head SHAs that were cancelled. */
  readonly superseded: number;
  /** Pull requests the listing did not show whose latest row was marked closed: a `closed` delivery was missed (E15-S01). */
  readonly markedClosed: number;
  /** Pull requests the listing showed whose latest row was marked open again: a `reopened` delivery was missed (E15-S01). */
  readonly markedOpen: number;
}

const byNumber = (pulls: readonly GitHubPullRequestRef[]): Map<number, GitHubPullRequestRef> =>
  new Map(pulls.map((pull) => [pull.number, pull]));

/**
 * Sweeps one repository of the tenant: at most ten pages of its open pull requests, one request per stale pull request the
 * pages did not show, and one `evaluate-pr` job (trigger `sweep`) for each pull request that needs one (see
 * {@link needsSweepEvaluation}). The list is read first, so a repository GitHub no longer shows ends here with
 * nothing sent and nothing written. When the list was read whole (not cut at the 1,000 pull requests of one run) it is also
 * a list of the pull requests worth asking about for `pr_state` (E15-S01): see {@link reconcilePullRequestStates}, which asks GitHub
 * about each row it would change; a list that failed on a page, or was cut, changes no state.
 * @throws GitHubNotFoundError and GitHubForbiddenError from the listing, a rate limit, and whatever the database, the queue or
 * the reporter throws; the caller decides what each means.
 */
export async function sweepRepository(
  ports: SweepPorts,
  context: SweepContext,
  tenant: Tenant,
): Promise<RepositorySweep> {
  const { installation, repository } = tenant;
  const scope = { installationId: installation.id, repositoryId: repository.id };
  const githubInstallationId = parseGithubId(installation.github_installation_id);
  const listedAt = ports.clock.now();
  const listing = await listOpenPulls(ports.github, githubInstallationId, repository.full_name);
  const now = ports.clock.now().getTime();
  const stale = await staleEvaluations(ports.db, scope, new Date(now - STALE_AFTER_SECONDS * 1000));
  const listed = byNumber(listing.pulls);
  const resolved = await resolveUnlisted(ports, context, tenant, { stale, listed });
  const open = byNumber([...listing.pulls, ...resolved.open]);
  const states = await evaluationStates(ports.db, scope, [...open.keys()]);
  const wanted = [...open.values()].filter((pull) =>
    needsSweepEvaluation(states.get(evaluationKey(pull.number, pull.headSha)), now),
  );
  const sent = await enqueueEvaluations(
    ports,
    context,
    {
      githubInstallationId,
      githubRepoId: parseGithubId(repository.github_repo_id),
      prNumbers: wanted.map((pull) => pull.number),
    },
    SWEEP_REQUEST,
  );
  const superseded = await cancelSuperseded(ports, tenant, { stale, open });
  const confirmOpen = async (prNumber: number): Promise<boolean> =>
    (await ports.github.getPullRequest(githubInstallationId, repository.full_name, prNumber))?.state === 'open';
  const corrected = listing.truncated
    ? { closed: 0, reopened: 0 }
    : await reconcilePullRequestStates(ports.db, scope, { open: [...open.keys()], listedAt }, confirmOpen);
  return {
    ...sent,
    listed: listing.pulls.length,
    truncated: listing.truncated,
    closed: resolved.closed,
    superseded,
    markedClosed: corrected.closed,
    markedOpen: corrected.reopened,
  };
}
