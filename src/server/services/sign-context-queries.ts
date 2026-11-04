// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// What the sign page context reads (E13-S02). The only statement that starts from a repository alone is
// `findSignRepository`: the sign link names the repository by GitHub's id and nothing else, so the tenant is found from it.
// Every statement after it takes the installation id of that row and puts it in its WHERE clause, so a document or a
// signature of another tenant is never read, whatever id is asked for. None of them writes.

/** The repository a sign link names, with the installation it belongs to and the state of that installation. */
export interface SignRepository {
  /** `installations.id` of the tenant that holds the repository: the scope of every later read. */
  readonly installationId: InstallationRowId;
  /** GitHub's id of that installation: the id a job names (`installations.github_installation_id`). */
  readonly githubInstallationId: number;
  /** `repositories.id`: the key a signature names as its source (`signatures.source_repository_id`). */
  readonly repositoryId: number;
  readonly githubRepoId: number;
  /** The `owner/name` GitHub showed at the last sync: a display snapshot. */
  readonly fullName: string;
  /** The document the repository enforces, or `null` when it has none. */
  readonly claDocumentId: number | null;
  /** The login of the account that installed the App: a display snapshot. */
  readonly accountLogin: string;
  readonly admissionStatus: 'admitted' | 'rejected';
  readonly suspendedAt: Date | null;
  readonly deletedAt: Date | null;
}

/**
 * The repository that is active under this GitHub id, whichever installation holds it, with that installation's state. At most
 * one row: a GitHub repository is active under one installation only. A repository that GitHub no longer lists for its
 * installation (removed) is not found. It reads across tenants on purpose, answers with the one row and never with a list, and
 * the caller decides from the installation's state whether to say anything about it.
 */
export async function findSignRepository(db: Kysely<Database>, githubRepoId: number): Promise<SignRepository | null> {
  const row = await db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select([
      'r.installation_id as installationId',
      'i.github_installation_id as githubInstallationId',
      'r.id as repositoryId',
      'r.github_repo_id as githubRepoId',
      'r.full_name as fullName',
      'r.cla_document_id as claDocumentId',
      'i.account_login as accountLogin',
      'i.admission_status as admissionStatus',
      'i.suspended_at as suspendedAt',
      'i.deleted_at as deletedAt',
    ])
    .where('r.github_repo_id', '=', githubRepoId)
    .where('r.removed_at', 'is', null)
    .executeTakeFirst();
  return row ?? null;
}

/** The version a document points at, with its exact stored text. */
interface ActiveVersion {
  readonly id: number;
  readonly major: number;
  readonly minor: number;
  readonly contentMd: string;
  readonly contentSha256: string;
  readonly rationale: string;
  readonly publishedAt: Date;
}

/** A document of the tenant with the version in force. */
export interface SignDocument {
  readonly id: number;
  readonly name: string;
  /** Who the document is for: only an `individual` document is signed through the sign page (corporate signing is E21). */
  readonly kind: 'individual' | 'corporate';
  readonly version: ActiveVersion;
}

/**
 * The document `documentId` of the tenant with its active version and the text of it, or `null` when the tenant has no such
 * document or the document has no active version yet. A draft is never read: the text is the one of the published version.
 */
export async function findSignDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<SignDocument | null> {
  const row = await db
    .selectFrom('cla_documents as d')
    .innerJoin('cla_versions as v', (join) =>
      join.onRef('v.id', '=', 'd.active_version_id').onRef('v.document_id', '=', 'd.id'),
    )
    .select([
      'd.id as documentId',
      'd.name as documentName',
      'd.kind as documentKind',
      'v.id as versionId',
      'v.major',
      'v.minor',
      'v.content_md as contentMd',
      'v.content_sha256 as contentSha256',
      'v.rationale',
      'v.published_at as publishedAt',
    ])
    .where('d.installation_id', '=', scope.installationId)
    .where('d.id', '=', documentId)
    .executeTakeFirst();
  if (row === undefined) {
    return null;
  }
  return {
    id: row.documentId,
    name: row.documentName,
    kind: row.documentKind,
    version: {
      id: row.versionId,
      major: row.major,
      minor: row.minor,
      contentMd: row.contentMd,
      contentSha256: row.contentSha256,
      rationale: row.rationale,
      publishedAt: row.publishedAt,
    },
  };
}

/** A signature of the person as the table stores it, with the minor of the version it was made under. */
export interface StoredSignature {
  readonly id: number;
  readonly major: number;
  readonly minor: number;
  readonly signedAt: Date;
  /** Set once the signature was revoked. */
  readonly revokedAt: Date | null;
}

/** The signatures of one person on one document of the tenant, with the minor of the version each was made under. */
function signaturesOf(db: Kysely<Database>, scope: TenantScope, userId: number, documentId: number) {
  return db
    .selectFrom('signatures as s')
    .innerJoin('cla_versions as v', (join) =>
      join.onRef('v.id', '=', 's.version_id').onRef('v.document_id', '=', 's.document_id'),
    )
    .select(['s.id', 's.major', 'v.minor', 's.signed_at as signedAt', 's.revoked_at as revokedAt'])
    .where('s.installation_id', '=', scope.installationId)
    .where('s.user_id', '=', userId)
    .where('s.document_id', '=', documentId);
}

/**
 * The signatures of the person (`users.id`) on the document of the tenant that decide where they stand: every one that is not
 * revoked (at most one per major version) and the newest one that was revoked. Another tenant's document finds nothing, and
 * so does a person who signed nothing there.
 */
export async function listViewerSignatures(
  db: Kysely<Database>,
  scope: TenantScope,
  userId: number,
  documentId: number,
): Promise<StoredSignature[]> {
  const [live, revoked] = await Promise.all([
    signaturesOf(db, scope, userId, documentId).where('s.revoked_at', 'is', null).orderBy('s.id').execute(),
    signaturesOf(db, scope, userId, documentId)
      .where('s.revoked_at', 'is not', null)
      .orderBy('s.signed_at', 'desc')
      .orderBy('s.id', 'desc')
      .limit(1)
      .execute(),
  ]);
  return [...live, ...revoked];
}
