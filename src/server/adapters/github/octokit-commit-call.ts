// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { GitHubCommitRef } from '../../services/ports/github.ts';
import { GitHubUnprocessableError } from '../../services/ports/github-errors.ts';
import { COMMIT_SHA, repositoryOf } from './octokit-names.ts';
import { type Channel, type RequestHeaders, readOrNull } from './octokit-request.ts';
import { commitRefSchema } from './schemas.ts';

// The request that tells whether a repository has a commit (E15-S05), made with an installation's token, so `headers` carry it. Only the
// SHA of the answer is read: the rest of a commit (its files, its patch) is neither needed nor kept.

/**
 * `GET /repos/{owner}/{repo}/commits/{ref}` with a full SHA as the `ref`, or null for a commit the repository does not have (404, or
 * 422 for a SHA that no commit of it has) and for a name or SHA that cannot be one: nothing else is ever put in the path. Every other
 * failure throws as the port documents.
 */
export async function fetchCommit(
  channel: Channel,
  headers: RequestHeaders,
  fullName: string,
  sha: string,
): Promise<GitHubCommitRef | null> {
  const route = 'GET /repos/{owner}/{repo}/commits/{ref}';
  const name = repositoryOf(fullName);
  if (name === null || !COMMIT_SHA.test(sha)) {
    return null;
  }
  try {
    return await readOrNull(
      channel,
      route,
      () => channel.octokit.request(route, { ...name, ref: sha, headers }),
      commitRefSchema,
    );
  } catch (error) {
    if (error instanceof GitHubUnprocessableError) {
      return null;
    }
    throw error;
  }
}
