// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The locking read behind attaching a CLA document to a repository and detaching it (E14-S02): the repository under lock with the
// document it has. It names the installation in its WHERE clause, so a repository of another tenant finds nothing. The other
// statements are in repository-document-queries.ts, the rules, the audit row and the job in repository-document-attach.ts.

/** A repository held for update, with the document it enforces. */
export interface LockedRepository {
  /** `repositories.id`. */
  readonly id: number;
  readonly githubRepoId: GithubId;
  /** GitHub's id of the installation, which the envelope of a job names. */
  readonly githubInstallationId: GithubId;
  readonly enabled: boolean;
  /** The document the repository enforces, or null when it has none. `repositoryId` is the repository the document is scoped to, null for one that covers the installation. */
  readonly document: { readonly id: number; readonly repositoryId: number | null } | null;
}

/** The document `documentId` of the tenant as the lock needs it: whom it covers. The foreign key guarantees the row, so a missing one is an error, not an answer. */
async function readDocumentScope(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<NonNullable<LockedRepository['document']>> {
  const row = await db
    .selectFrom('cla_documents')
    .select(['id', 'repository_id'])
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', documentId)
    .executeTakeFirstOrThrow();
  return { id: row.id, repositoryId: row.repository_id };
}

/**
 * Locks the repository `repositoryId` of the tenant until the end of the caller's transaction (`select ... for update`, the
 * repository row only) and reads the document it enforces, so two changes of the CLA of one repository run one after the
 * other and the second reads what the first left. The locking read returns the newest committed version of the row it locks and
 * only that one (a row it joins is read as of the statement's start), which is why the pointer is taken from the locked row and
 * the document is read by a statement of its own after the lock. A removed repository is not found.
 * @returns the locked repository, or null when the tenant has no such repository.
 * @throws NoResultError when the repository points at a document the tenant does not have (the foreign key forbids it).
 */
export async function lockRepositoryForDocumentChange(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
): Promise<LockedRepository | null> {
  const row = await db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select(['r.id', 'r.github_repo_id', 'r.enabled', 'r.cla_document_id', 'i.github_installation_id'])
    .where('r.installation_id', '=', scope.installationId)
    .where('r.id', '=', repositoryId)
    .where('r.removed_at', 'is', null)
    .forUpdate('r')
    .executeTakeFirst();
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    githubRepoId: parseGithubId(row.github_repo_id),
    githubInstallationId: parseGithubId(row.github_installation_id),
    enabled: row.enabled,
    document: row.cla_document_id === null ? null : await readDocumentScope(db, scope, row.cla_document_id),
  };
}
