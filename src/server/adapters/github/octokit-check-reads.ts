// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CHECK_RUN_NAME } from '../../../shared/check.ts';
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubCheckRun } from '../../services/ports/github.ts';
import { COMMIT_SHA, checked, PER_PAGE, repositoryOf } from './octokit-names.ts';
import { type Channel, parseOne, type RequestHeaders, readOrNull } from './octokit-request.ts';
import { checkRunPageSchema, checkRunSchema } from './schemas.ts';

// The reads of the Check Run writer (E09-S05): a run by its id and the runs of a commit. They are made with an installation's
// token, so `headers` carry it, and nothing that cannot be a name or a SHA reaches a path or a query.

/** `GET /repos/{owner}/{repo}/check-runs/{check_run_id}`, or null for a run that does not exist. */
export function fetchCheckRun(
  channel: Channel,
  headers: RequestHeaders,
  fullName: string,
  checkRunId: GithubId,
): Promise<GitHubCheckRun | null> {
  const route = 'GET /repos/{owner}/{repo}/check-runs/{check_run_id}';
  const name = repositoryOf(fullName);
  if (name === null) {
    return Promise.resolve(null);
  }
  return readOrNull(
    channel,
    route,
    () => channel.octokit.request(route, { ...name, check_run_id: checkRunId, headers }),
    checkRunSchema,
  );
}

/**
 * The first page of `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` for the runs named `CHECK_RUN_NAME`, the latest of each
 * App; empty for a SHA GitHub cannot hold. @throws GitHubNotFoundError for a repository or name GitHub cannot hold.
 */
export async function fetchCheckRunsForRef(
  channel: Channel,
  headers: RequestHeaders,
  fullName: string,
  headSha: string,
): Promise<GitHubCheckRun[]> {
  const route = 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs';
  const name = checked(route, fullName);
  if (!COMMIT_SHA.test(headSha)) {
    return [];
  }
  const page = await channel.send(route, () =>
    channel.octokit.request(route, {
      ...name,
      ref: headSha,
      check_name: CHECK_RUN_NAME,
      filter: 'latest',
      per_page: PER_PAGE,
      headers,
    }),
  );
  return parseOne(route, checkRunPageSchema, page.data);
}
