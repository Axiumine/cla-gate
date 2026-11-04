// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Expression, Kysely, SqlBool } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { latestEvaluationPerPr } from './current-evaluation-queries.ts';

// The statements behind the pull requests an action of a maintainer re-evaluates (E15-S03, E15-S05, E15-S06). Both start from the latest
// evaluation of each pull request (E15-S01), named with the installation, and filter on the outer query, as the query asks: the newest
// row of a pull request decides, never an older head SHA that happens to match. The repository is read with its installation id too,
// for the ids a job names (GitHub's, never the surrogate keys of our tables).

/** The question a latest row must answer to be affected, besides the pull request being open. */
export interface AffectedFilter {
  /** The result the latest row has: `success` for the pull requests a revocation can turn red, `failure` for the ones an override can turn green. */
  readonly result: 'success' | 'failure';
  /** A condition on the stored details of the row (`pr_evaluations.details`), built on the expression it is given; none for every row of the result. */
  readonly detailsMatch?: (details: Expression<unknown>) => Expression<SqlBool>;
}

/** A repository by the surrogate key of its row and by the ids a job names. */
export interface AffectedRepository {
  readonly repositoryId: number;
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
}

/** A pull request of such a repository. */
export interface AffectedPullRequest extends AffectedRepository {
  readonly prNumber: number;
}

/** The latest rows of the open pull requests of `repositoryIds` that answer the filter, with their repository, as a query to select from. */
function affectedRows(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryIds: readonly number[],
  filter: AffectedFilter,
) {
  const { detailsMatch } = filter;
  const rows = db
    .selectFrom(latestEvaluationPerPr(db, scope.installationId, repositoryIds).as('latest'))
    .innerJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 'latest.repository_id').onRef('r.installation_id', '=', 'latest.installation_id'),
    )
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select([
      'latest.repository_id as repositoryId',
      'i.github_installation_id as githubInstallationId',
      'r.github_repo_id as githubRepoId',
    ])
    .where('latest.pr_state', '=', 'open')
    .where('latest.result', '=', filter.result);
  return detailsMatch === undefined ? rows : rows.where((eb) => detailsMatch(eb.ref('latest.details')));
}

/** The repository of a row, with the ids a job names read through the schema of a GitHub id. */
function repositoryOf(row: {
  readonly repositoryId: number;
  readonly githubInstallationId: number;
  readonly githubRepoId: number;
}): AffectedRepository {
  return {
    repositoryId: row.repositoryId,
    githubInstallationId: parseGithubId(row.githubInstallationId),
    githubRepoId: parseGithubId(row.githubRepoId),
  };
}

/**
 * The open pull requests of the repositories `repositoryIds` of the tenant whose latest evaluation answers the filter, in the order
 * of repository and number, at most `limit`. A closed pull request, one whose latest row is in progress or cancelled, and one whose
 * older head SHA matched while the latest does not, are not listed. The installation is in the query, so a repository id of another
 * tenant finds nothing.
 */
export async function findAffectedPrs(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryIds: readonly number[],
  filter: AffectedFilter & { readonly limit: number },
): Promise<AffectedPullRequest[]> {
  const rows = await affectedRows(db, scope, repositoryIds, filter)
    .select('latest.pr_number as prNumber')
    .orderBy('latest.repository_id')
    .orderBy('latest.pr_number')
    .limit(filter.limit)
    .execute();
  return rows.map((row) => ({ ...repositoryOf(row), prNumber: row.prNumber }));
}

/**
 * The repositories among `repositoryIds` that have at least one pull request {@link findAffectedPrs} would list, in the order of
 * their ids: the repositories to sweep when there are too many pull requests to evaluate one by one.
 */
export async function findAffectedRepositories(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryIds: readonly number[],
  filter: AffectedFilter,
): Promise<AffectedRepository[]> {
  const rows = await affectedRows(db, scope, repositoryIds, filter)
    .distinct()
    .orderBy('latest.repository_id')
    .execute();
  return rows.map(repositoryOf);
}
