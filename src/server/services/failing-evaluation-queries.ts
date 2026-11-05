// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { uncoveredActorNeedle } from '../domain/signature-evaluations.ts';

// The one statement behind the signer's other failing pull requests (E13-S07). It names the installation of the signature in its
// WHERE clause and again in the subquery that finds the newer rows, so an evaluation of another tenant is never read, whatever
// document id or person is asked for, and the composite foreign keys of migration 001 hold the same line in the database: a
// repository can enforce only a document of its own installation.

/** The stored failure of one pull request, as the lookup reads it: the repository by GitHub's id, and the details unparsed. */
export interface FailingEvaluation {
  readonly githubRepoId: number;
  readonly prNumber: number;
  /** `pr_evaluations.details` as the database holds it: the caller reads it through the schema of E08. */
  readonly details: unknown;
}

/** What the lookup asks for. */
export interface FailingLookup {
  /** The signed document: only repositories attached to it are looked at. */
  readonly documentId: number;
  /** The signer, by the numeric GitHub id the stored details name. */
  readonly githubId: GithubId;
  /** The pull request the signing came from (`repositories.id` and number), left out because its own job is sent; `null` for none. */
  readonly origin: { readonly repositoryId: number; readonly prNumber: number } | null;
  /** The most rows read. */
  readonly limit: number;
}

/**
 * The latest evaluation of each pull request of the tenant, for the pull requests of repositories attached to the document that
 * still fail and whose stored details list the signer among the actors that are not covered. "Latest" is the row touched last
 * (`updated_at`, then the id): a pull request whose newest evaluation passes, is in progress or was cancelled is not listed, even
 * when an older head SHA of it failed. A pull request that is closed (`pr_state`, E15-S01) is not listed either: nothing is
 * evaluated again for it, and the signer's new signature must not send work for it. Newest first, at most `limit` rows, so a
 * pull request appears once. Repositories that GitHub no longer lists (removed) are left out: nothing can be evaluated there.
 * The pull request of `origin` is left out in the statement, so that it does not use up a row of the limit. The containment
 * test on the details only narrows the rows; the caller decides on the parsed value.
 */
export async function findFailingEvaluations(
  db: Kysely<Database>,
  scope: TenantScope,
  lookup: FailingLookup,
): Promise<FailingEvaluation[]> {
  const originRepositoryId = lookup.origin?.repositoryId ?? null;
  const originPrNumber = lookup.origin?.prNumber ?? null;
  return db
    .selectFrom('pr_evaluations as e')
    .innerJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 'e.repository_id').onRef('r.installation_id', '=', 'e.installation_id'),
    )
    .select(['r.github_repo_id as githubRepoId', 'e.pr_number as prNumber', 'e.details'])
    .where('e.installation_id', '=', scope.installationId)
    .where('r.cla_document_id', '=', lookup.documentId)
    .where('r.removed_at', 'is', null)
    .where('e.result', '=', 'failure')
    .where('e.pr_state', '=', 'open')
    .where(sql<boolean>`e.details @> ${uncoveredActorNeedle(lookup.githubId)}::jsonb`)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('pr_evaluations as newer')
            .select('newer.id')
            .where('newer.installation_id', '=', scope.installationId)
            .whereRef('newer.repository_id', '=', 'e.repository_id')
            .whereRef('newer.pr_number', '=', 'e.pr_number')
            .where(sql<boolean>`(newer.updated_at, newer.id) > (e.updated_at, e.id)`),
        ),
      ),
    )
    .where(sql<boolean>`not coalesce(r.id = ${originRepositoryId} and e.pr_number = ${originPrNumber}, false)`)
    .orderBy('e.updated_at', 'desc')
    .orderBy('e.id', 'desc')
    .limit(lookup.limit)
    .execute();
}
