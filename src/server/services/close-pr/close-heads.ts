// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { PullRequestEvaluation, RepositoryScope } from './close-rows.ts';

// The head SHAs a closed pull request names to the queue (E07-S06). Every statement filters by the installation.

/** The ones of `headShas` at which another pull request of the repository was evaluated too. */
async function headShasOfOtherPullRequests(
  db: Kysely<Database>,
  scope: RepositoryScope,
  prNumber: number,
  headShas: readonly string[],
): Promise<ReadonlySet<string>> {
  if (headShas.length === 0) {
    return new Set();
  }
  const rows = await db
    .selectFrom('pr_evaluations')
    .select('head_sha')
    .distinct()
    .where('installation_id', '=', scope.installationId)
    .where('repository_id', '=', scope.repositoryId)
    .where('pr_number', '<>', prNumber)
    .where('head_sha', 'in', headShas)
    .execute();
  return new Set(rows.map((row) => row.head_sha));
}

/**
 * The head SHAs the queue is asked about: the ones the pull request was evaluated at and the one GitHub shows now, each
 * once, without the ones that another pull request of the repository was evaluated at. Two pull requests can share a head
 * SHA (one branch proposed to two base branches), and an `evaluate-head-sha` job that names it may be wanted by the one that
 * stays open. A job that is left alone ends on its own, because it finds no open pull request at the SHA.
 */
export async function headShasToCancel(
  db: Kysely<Database>,
  scope: RepositoryScope,
  pullRequest: {
    readonly prNumber: number;
    /** The evaluations stored for it. */
    readonly evaluations: readonly PullRequestEvaluation[];
    /** The head SHA GitHub shows for it now, when it still shows it. */
    readonly currentHeadSha: string | undefined;
  },
): Promise<string[]> {
  const evaluatedAt = pullRequest.evaluations.map((evaluation) => evaluation.headSha);
  const { currentHeadSha } = pullRequest;
  const headShas = [...new Set(currentHeadSha === undefined ? evaluatedAt : [...evaluatedAt, currentHeadSha])];
  const shared = await headShasOfOtherPullRequests(db, scope, pullRequest.prNumber, headShas);
  return headShas.filter((headSha) => !shared.has(headSha));
}
