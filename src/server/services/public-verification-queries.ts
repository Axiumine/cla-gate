// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// What the public signature check reads (E22-S02). The only statement that starts from a repository alone is
// `findPublicRepository`: the public call names the repository by GitHub's id and nothing else, so the tenant is found from it.
// The statement after it takes the installation id of that row and puts it in its WHERE clause, so a signature or a document of
// another tenant is never read, whatever ids are asked for. Neither of them writes.

/** The repository a public call names, with the installation it belongs to and what decides whether it may be asked about. */
export interface PublicRepository {
  /** `installations.id` of the tenant that holds the repository: the scope of the read that follows. */
  readonly installationId: InstallationRowId;
  /** GitHub's id of that installation: the id the GitHub client takes to mint the token of the lookup. */
  readonly githubInstallationId: GithubId;
  /** Whether enforcement is on (`repositories.enabled`). */
  readonly enabled: boolean;
  /** Whether the maintainers opted in to the public check (`repositories.public_verification`). */
  readonly publicVerification: boolean;
  /** The document the repository enforces, or `null` when it has none. */
  readonly claDocumentId: number | null;
  readonly admissionStatus: 'admitted' | 'rejected';
  readonly suspendedAt: Date | null;
  readonly deletedAt: Date | null;
}

/**
 * The repository that is active under this GitHub id, whichever installation holds it, with that installation's state and the
 * two flags that decide whether the public check may speak of it. At most one row: a GitHub repository is active under one
 * installation only. A repository that GitHub no longer lists for its installation (removed) is not found. It reads across
 * tenants on purpose, answers with the one row and never with a list, and the caller turns an unknown repository, a tenant that
 * is not served and a repository that is not opted in into one and the same answer.
 */
export async function findPublicRepository(
  db: Kysely<Database>,
  githubRepoId: GithubId,
): Promise<PublicRepository | null> {
  const row = await db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select([
      'r.installation_id as installationId',
      'i.github_installation_id as githubInstallationId',
      'r.enabled',
      'r.public_verification as publicVerification',
      'r.cla_document_id as claDocumentId',
      'i.admission_status as admissionStatus',
      'i.suspended_at as suspendedAt',
      'i.deleted_at as deletedAt',
    ])
    .where('r.github_repo_id', '=', githubRepoId)
    .where('r.removed_at', 'is', null)
    .executeTakeFirst();
  return row === undefined ? null : { ...row, githubInstallationId: parseGithubId(row.githubInstallationId) };
}

/**
 * Whether the person with this numeric GitHub id has a signature that counts on the document of the tenant: an individual
 * signature that is not revoked, made at the major version the document has now. The person is found through `users.github_id`
 * and never through a login or an e-mail; a document of another tenant, a document with no active version and a person who
 * signed nothing there all answer false. The rule is the one of the evaluation (`covers` of the engine), without the exemptions
 * that are not signatures.
 */
export async function hasCountingSignature(
  db: Kysely<Database>,
  scope: TenantScope,
  subject: { readonly documentId: number; readonly githubId: GithubId },
): Promise<boolean> {
  const row = await db
    .selectFrom('signatures as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 's.document_id').onRef('d.installation_id', '=', 's.installation_id'),
    )
    .innerJoin('cla_versions as v', (join) =>
      join.onRef('v.id', '=', 'd.active_version_id').onRef('v.document_id', '=', 'd.id'),
    )
    .select('s.id')
    .where('s.installation_id', '=', scope.installationId)
    .where('s.document_id', '=', subject.documentId)
    .where('s.signer_type', '=', 'individual')
    .where('s.revoked_at', 'is', null)
    .whereRef('s.major', '=', 'v.major')
    .where('u.github_id', '=', subject.githubId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
