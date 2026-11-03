// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { StoredActiveVersion } from './cla-document-types.ts';
import { toStoredVersion } from './cla-version-rows.ts';

// The statements that read what publishing a version of a CLA decides on (E12-S04): the document under lock, its active
// version and the signatures a new major would make stale. The repositories that enforce the document are in
// cla-enforcing-queries.ts. Every one names the
// installation in its WHERE clause, so a document id of another tenant finds nothing. The statements that write a version are in
// cla-version-writes.ts; the rules (numbering, guards, audit, jobs) are in cla-publish.ts.

/** A document row held for update: its id and the version it points at (null before the first publish). */
export interface LockedDocument {
  readonly id: number;
  readonly activeVersionId: number | null;
}

/**
 * Locks the document `documentId` of the tenant until the end of the caller's transaction (`select ... for update`) and reads
 * the version it points at. A second publish waits here, and when it gets the row it reads the pointer the first one set: the
 * locking read of a plain table returns the newest committed row, which is why the version itself is read by a statement of its
 * own after the lock ({@link findActiveVersion}).
 * @returns the locked document, or null when the tenant has no such document.
 */
export async function lockDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<LockedDocument | null> {
  const row = await db
    .selectFrom('cla_documents')
    .select(['id', 'active_version_id'])
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', documentId)
    .forUpdate()
    .executeTakeFirst();
  return row === undefined ? null : { id: row.id, activeVersionId: row.active_version_id };
}

/** The version the document `documentId` of the tenant points at (the text is not read), or null when it has none or the tenant has no such document. */
export async function findActiveVersion(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<StoredActiveVersion | null> {
  const row = await db
    .selectFrom('cla_documents as d')
    .innerJoin('cla_versions as v', (join) =>
      join.onRef('v.id', '=', 'd.active_version_id').onRef('v.document_id', '=', 'd.id'),
    )
    .select(['v.id', 'v.major', 'v.minor', 'v.content_sha256', 'v.published_at'])
    .where('d.installation_id', '=', scope.installationId)
    .where('d.id', '=', documentId)
    .executeTakeFirst();
  return row === undefined ? null : toStoredVersion(row);
}

/**
 * How many signatures on the document `documentId` of the tenant are at `major` and not revoked: the people who would have to
 * sign again if the document moved to the next major. A revoked signature does not count, whatever its major.
 */
export async function countSignaturesAtMajor(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
  major: number,
): Promise<number> {
  const row = await db
    .selectFrom('signatures')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('installation_id', '=', scope.installationId)
    .where('document_id', '=', documentId)
    .where('major', '=', major)
    .where('revoked_at', 'is', null)
    .executeTakeFirstOrThrow();
  return row.n;
}
