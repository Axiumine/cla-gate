// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statement that reads which repositories enforce a CLA document (E12-S04), for the jobs a new major version sends. It names
// the installation in its WHERE clause, so a document id of another tenant finds nothing. The other reads of publishing are in
// cla-version-queries.ts.

/** A repository that enforces a document, by the ids a job names: GitHub's, never the surrogate keys of our tables. */
interface EnforcingRepository {
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
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
  const rows = await db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select(['i.github_installation_id', 'r.github_repo_id'])
    .where('r.installation_id', '=', scope.installationId)
    .where('r.cla_document_id', '=', documentId)
    .where('r.enabled', '=', true)
    .where('r.removed_at', 'is', null)
    .orderBy('r.id')
    .execute();
  return rows.map((row) => ({
    githubInstallationId: parseGithubId(row.github_installation_id),
    githubRepoId: parseGithubId(row.github_repo_id),
  }));
}
