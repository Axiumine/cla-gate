// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CHECK_RUN_NAME } from '../../../shared/check.ts';
import type { GithubId } from '../../../shared/github-id.ts';
import type { CheckRunWrite, GitHubCheckRun } from '../../services/ports/github.ts';
import { checked } from './octokit-names.ts';
import { type Channel, parseOne, type RequestHeaders } from './octokit-request.ts';
import { checkRunSchema } from './schemas.ts';

// The writes of the Check Run writer (E09-S05): a run is created and updated. They are made
// with an installation's token, so `headers` carry it, and nothing that cannot be a name or a SHA reaches a path or a query.
// The body is built here from the write and from nothing else, so a field the write does not name is never sent.

/** The `output` object of GitHub: the text is left out when the write has none. */
function outputOf(write: CheckRunWrite): { title: string; summary: string; text?: string } {
  return {
    title: write.title,
    summary: write.summary,
    ...(write.text === undefined ? {} : { text: write.text }),
  };
}

/** The fields of a write that `POST` and `PATCH` both take, in GitHub's spelling. */
function sharedBody(write: CheckRunWrite) {
  return {
    status: write.status,
    ...(write.conclusion === undefined ? {} : { conclusion: write.conclusion }),
    ...(write.completedAt === undefined ? {} : { completed_at: write.completedAt.toISOString() }),
    ...(write.externalId === undefined ? {} : { external_id: write.externalId }),
    ...(write.detailsUrl === undefined ? {} : { details_url: write.detailsUrl }),
    output: outputOf(write),
  };
}

/** `POST /repos/{owner}/{repo}/check-runs`: a new run on `headSha`. @throws GitHubNotFoundError for a name or SHA GitHub cannot hold. */
export async function postCheckRun(
  channel: Channel,
  headers: RequestHeaders,
  target: { readonly fullName: string; readonly headSha: string },
  write: CheckRunWrite,
): Promise<GitHubCheckRun> {
  const route = 'POST /repos/{owner}/{repo}/check-runs';
  const name = checked(route, target.fullName, [target.headSha]);
  const started = write.startedAt === undefined ? {} : { started_at: write.startedAt.toISOString() };
  const page = await channel.send(route, () =>
    channel.octokit.request(route, {
      ...name,
      name: CHECK_RUN_NAME,
      head_sha: target.headSha,
      ...started,
      ...sharedBody(write),
      headers,
    }),
  );
  return parseOne(route, checkRunSchema, page.data);
}

/** `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}`. @throws GitHubNotFoundError for a name GitHub cannot hold. */
export async function patchCheckRun(
  channel: Channel,
  headers: RequestHeaders,
  target: { readonly fullName: string; readonly checkRunId: GithubId },
  write: CheckRunWrite,
): Promise<GitHubCheckRun> {
  const route = 'PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}';
  const name = checked(route, target.fullName);
  const page = await channel.send(route, () =>
    channel.octokit.request(route, {
      ...name,
      check_run_id: target.checkRunId,
      ...sharedBody(write),
      headers,
    }),
  );
  return parseOne(route, checkRunSchema, page.data);
}
