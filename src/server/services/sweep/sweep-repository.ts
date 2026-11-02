// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../shared/github-id.ts';
import { needsSweepEvaluation, STALE_AFTER_SECONDS } from '../../domain/sweep.ts';
import type { Tenant } from '../evaluate-pr/evaluation-facts.ts';
import type { GitHubPullRequestRef } from '../ports/github.ts';
import { listOpenPulls } from './open-pulls.ts';
import { cancelSuperseded, resolveUnlisted } from './reaper.ts';
import { enqueueEvaluations, type SendCounts } from './sweep-enqueue.ts';
import type { SweepContext, SweepPorts } from './sweep-ports.ts';
import { evaluationKey, evaluationStates, staleEvaluations } from './sweep-rows.ts';

// The sweep of one repository (E07-S08): the open pull requests are read, the ones with no final result for their head SHA are
// sent to be evaluated, and the evaluations that stayed `in_progress` are settled by the reaper.

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
}

const byNumber = (pulls: readonly GitHubPullRequestRef[]): Map<number, GitHubPullRequestRef> =>
  new Map(pulls.map((pull) => [pull.number, pull]));

/**
 * Sweeps one repository of the tenant: at most ten pages of its open pull requests, one request per stale pull request the
 * pages did not show, and one `evaluate-pr` job (trigger `sweep`) for each pull request that needs one (see
 * {@link needsSweepEvaluation}). The list is read first, so a repository GitHub no longer shows ends here with
 * nothing sent and nothing written.
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
    { githubInstallationId, githubRepoId: parseGithubId(repository.github_repo_id) },
    wanted.map((pull) => pull.number),
  );
  const superseded = await cancelSuperseded(ports, tenant, { stale, open });
  return { ...sent, listed: listing.pulls.length, truncated: listing.truncated, closed: resolved.closed, superseded };
}
