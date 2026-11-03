// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { StoredActiveVersion } from './cla-document-types.ts';
import { toStoredVersion } from './cla-version-rows.ts';

// The statements that write a version of a CLA and move the pointer to it (E12-S04); the reads are in cla-version-queries.ts.
// Both name the installation next to the document id, and both are called by `publishVersion` after it has locked the document.
// `cla_versions` is append-only (the triggers of migration 001 refuse every update and delete), and the pointer only moves
// forward (a trigger refuses anything but the highest version), so neither statement can rewrite history.

/** What a new version is made of: the text is canonical and hashed already (`prepareClaText`), the person is `users.id`, the rationale is cleaned. */
export interface NewVersion {
  readonly documentId: number;
  readonly major: number;
  readonly minor: number;
  readonly contentMd: string;
  readonly contentSha256: string;
  readonly publishedBy: number;
  readonly rationale: string;
}

/**
 * Appends the version to the document of the tenant: the row is selected from the document with the installation id in the
 * WHERE clause, so another tenant's document gets none. The database checks that the hash is the SHA-256 of the text, that
 * `(document_id, major, minor)` is new and that the publication time is its own clock's. A number that is already taken is the
 * unique violation of `cla_versions_document_id_major_minor_key`, which the caller reads.
 * @throws NoResultError when the tenant has no such document (the caller holds its lock, so this is a defect, not a case).
 */
export async function insertVersion(
  db: Kysely<Database>,
  scope: TenantScope,
  input: NewVersion,
): Promise<StoredActiveVersion> {
  const row = await db
    .insertInto('cla_versions')
    .columns(['document_id', 'major', 'minor', 'content_md', 'content_sha256', 'published_by', 'rationale'])
    .expression((eb) =>
      eb
        .selectFrom('cla_documents as d')
        .select([
          'd.id',
          eb.cast<number>(eb.val(input.major), 'integer').as('major'),
          eb.cast<number>(eb.val(input.minor), 'integer').as('minor'),
          eb.cast<string>(eb.val(input.contentMd), 'text').as('content_md'),
          eb.cast<string>(eb.val(input.contentSha256), 'text').as('content_sha256'),
          eb.cast<number>(eb.val(input.publishedBy), 'bigint').as('published_by'),
          eb.cast<string>(eb.val(input.rationale), 'text').as('rationale'),
        ])
        .where('d.installation_id', '=', scope.installationId)
        .where('d.id', '=', input.documentId),
    )
    .returning(['id', 'major', 'minor', 'content_sha256', 'published_at'])
    .executeTakeFirstOrThrow();
  return toStoredVersion(row);
}

/**
 * Points the document of the tenant at the version `versionId` and stamps the change. The foreign key refuses a version of
 * another document, and the trigger refuses one that is not the document's highest.
 * @throws NoResultError when the tenant has no such document (the caller holds its lock, so this is a defect, not a case).
 */
export async function setActiveVersion(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
  versionId: number,
): Promise<void> {
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: versionId, updated_at: sql`now()` })
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', documentId)
    .returning('id')
    .executeTakeFirstOrThrow();
}
