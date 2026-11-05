// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statement that reads which repositories enforce a CLA document (E12-S04), for the jobs a new major version sends. It names
// the installation in its WHERE clause, so a document id of another tenant finds nothing. The other reads of publishing are in
// cla-version-queries.ts.

/** A repository that enforces a document, by the ids a job names (GitHub's) and by the key of its row. */
interface EnforcingRepository {
  /** `repositories.id`, which the reads of the evaluations of a repository (E15-S03) are keyed by; no job names it. */
  readonly repositoryId: number;
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
}

/** The repositories of the tenant that enforce the document `documentId`, as a query to select from: attached to it, enabled, and not removed. */
function enforcing(db: Kysely<Database>, scope: TenantScope, documentId: number) {
  return db
    .selectFrom('repositories as r')
    .where('r.installation_id', '=', scope.installationId)
    .where('r.cla_document_id', '=', documentId)
    .where('r.enabled', '=', true)
    .where('r.removed_at', 'is', null);
}

/**
 * The repositories of the tenant that enforce the document `documentId`: attached to it, enabled, and not removed. A repository
 * that is disabled enforces nothing, and one that GitHub no longer lists is not evaluated. In the order of their row ids.
 */
export async function listEnforcingRepositories(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<EnforcingRepository[]> {
  const rows = await enforcing(db, scope, documentId)
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select(['r.id', 'i.github_installation_id', 'r.github_repo_id'])
    .orderBy('r.id')
    .execute();
  return rows.map((row) => ({
    repositoryId: row.id,
    githubInstallationId: parseGithubId(row.github_installation_id),
    githubRepoId: parseGithubId(row.github_repo_id),
  }));
}

/** How many repositories {@link listEnforcingRepositories} lists, for a preview that shows a number and no repository (E15-S04). */
export async function countEnforcingRepositories(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<number> {
  const row = await enforcing(db, scope, documentId)
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow();
  return row.count;
}
