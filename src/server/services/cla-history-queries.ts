// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { VersionNumber } from '../domain/version-number.ts';
import {
  atOrBelow,
  HISTORY_COLUMNS,
  type HistoryVersion,
  type HistoryVersionText,
  toHistoryVersion,
  toHistoryVersionText,
} from './cla-history-rows.ts';

// The statements that read the history of a CLA document (E12-S05): the versions in the order of their numbers, and one version
// with its exact text. Both join the document and put the installation in the WHERE clause next to the document id, so a
// version of another document or of another tenant is never found; the signatures are counted with the installation id too.
// Nothing here writes: a published version never changes (the triggers of migration 001 refuse it), and no route can ask for it.

/** The versions of the document `documentId` of the tenant with who published each, whether the document points at it and its live signatures. */
function selectVersions(db: Kysely<Database>, scope: TenantScope, documentId: number) {
  return db
    .selectFrom('cla_versions as v')
    .innerJoin('cla_documents as d', 'd.id', 'v.document_id')
    .innerJoin('users as u', 'u.id', 'v.published_by')
    .select([
      ...HISTORY_COLUMNS,
      sql<number>`(
        select count(*) from signatures as s
        where s.version_id = v.id and s.installation_id = d.installation_id and s.revoked_at is null
      )`.as('signature_count'),
    ])
    .where('d.installation_id', '=', scope.installationId)
    .where('v.document_id', '=', documentId);
}

/**
 * Up to `page.limit` versions of the document of the tenant by `major desc, minor desc`, starting at `page.from` (that number
 * included) when it is given. A number is unique within a document, so no version is skipped or repeated between pages.
 */
export async function listVersions(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
  page: { readonly limit: number; readonly from: VersionNumber | null },
): Promise<HistoryVersion[]> {
  const { from } = page;
  const all = selectVersions(db, scope, documentId);
  const rows = await (from === null ? all : all.where(atOrBelow(from)))
    .orderBy('v.major', 'desc')
    .orderBy('v.minor', 'desc')
    .limit(page.limit)
    .execute();
  return rows.map(toHistoryVersion);
}

/**
 * The version `versionId` of the document `documentId` of the tenant with its exact text, or null when that document of the
 * tenant has no such version: `where v.id = $1 and v.document_id = $2 and d.installation_id = $3`.
 */
export async function findVersion(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
  versionId: number,
): Promise<HistoryVersionText | null> {
  const row = await selectVersions(db, scope, documentId)
    .select('v.content_md')
    .where('v.id', '=', versionId)
    .executeTakeFirst();
  return row === undefined ? null : toHistoryVersionText(row);
}
