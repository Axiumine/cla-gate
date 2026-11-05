// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { mapFound } from './when-present.ts';

// The statements behind the corporate CLA document of a repository (E21-S02), over `repositories.corporate_document_id` of migration
// 020: the read the signing page and the signing request start from, and the locking read, the check and the write of the choice of a
// maintainer. Every one names the installation in its WHERE clause, so a repository or a document of another tenant is never read or
// changed; the composite foreign key `(corporate_document_id, installation_id)` and the trigger that wants the kind `corporate` are the
// second line in the database.

/** What the corporate flow needs of a repository besides the sign target: whether it enforces, and the corporate document it has. */
export interface CorporateSetting {
  readonly enabled: boolean;
  /** The corporate CLA document of the repository, or `null` when it accepts individual signatures only. */
  readonly corporateDocumentId: number | null;
}

/**
 * The corporate setting of the repository `repositoryId` of the tenant that is not removed, or `null` when the tenant has no such
 * repository (another tenant's included).
 */
export async function findCorporateSetting(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
): Promise<CorporateSetting | null> {
  const row = await db
    .selectFrom('repositories')
    .select(['enabled', 'corporate_document_id'])
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', repositoryId)
    .where('removed_at', 'is', null)
    .executeTakeFirst();
  return mapFound(row, (found) => ({ enabled: found.enabled, corporateDocumentId: found.corporate_document_id }));
}

/** A repository held for update, with the corporate document it has. */
export interface LockedCorporateRepository {
  /** `repositories.id`. */
  readonly id: number;
  /** GitHub's id of the repository: the subject of the audit row, which names no repository. */
  readonly githubRepoId: GithubId;
  /** GitHub's id of the installation, which the envelope of a job names. */
  readonly githubInstallationId: GithubId;
  /** Whether the repository enforces the CLA: only then is there a pull request to evaluate again after a change. */
  readonly enabled: boolean;
  readonly corporateDocumentId: number | null;
}

/**
 * Locks the repository `repositoryId` of the tenant until the end of the caller's transaction (`select ... for update`, the repository
 * row only), so two choices of the corporate document of one repository run one after the other and the second reads what the first
 * left. A removed repository is not found.
 * @returns the locked repository, or `null` when the tenant has no such repository.
 */
export async function lockCorporateRepository(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
): Promise<LockedCorporateRepository | null> {
  const row = await db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select(['r.id', 'r.github_repo_id', 'r.enabled', 'r.corporate_document_id', 'i.github_installation_id'])
    .where('r.installation_id', '=', scope.installationId)
    .where('r.id', '=', repositoryId)
    .where('r.removed_at', 'is', null)
    .forUpdate('r')
    .executeTakeFirst();
  return mapFound(row, (found) => ({
    id: found.id,
    githubRepoId: parseGithubId(found.github_repo_id),
    githubInstallationId: parseGithubId(found.github_installation_id),
    enabled: found.enabled,
    corporateDocumentId: found.corporate_document_id,
  }));
}

/**
 * The id of the document `documentId` when the repository `repositoryId` of the tenant may take it as its corporate CLA: it belongs
 * to the tenant, it is of the corporate kind, and it covers the whole installation or is scoped to this very repository. `null` for
 * everything else, which the caller answers alike: no document, another tenant's, another repository's and an individual one cannot be
 * told apart.
 */
export async function findCorporateChoice(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
  documentId: number,
): Promise<number | null> {
  const row = await db
    .selectFrom('cla_documents')
    .select('id')
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', documentId)
    .where('kind', '=', 'corporate')
    .where((condition) =>
      condition.or([condition('repository_id', 'is', null), condition('repository_id', '=', repositoryId)]),
    )
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * Points the repository `repositoryId` of the tenant at the corporate document `documentId`, or at none (`null`), and touches its
 * `updated_at`. The composite foreign key refuses a document of another installation and the trigger one that is not corporate.
 * @returns the time of the change, which names it.
 * @throws NoResultError when the tenant has no such repository (the caller holds its lock, so it does not happen).
 */
export async function setCorporateDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
  documentId: number | null,
): Promise<Date> {
  const row = await db
    .updateTable('repositories')
    .set({ corporate_document_id: documentId, updated_at: sql`now()` })
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', repositoryId)
    .where('removed_at', 'is', null)
    .returning('updated_at')
    .executeTakeFirstOrThrow();
  return row.updated_at;
}
