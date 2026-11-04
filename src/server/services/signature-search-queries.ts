// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { SEARCH_COLUMNS, SIGNED_AT_MICROS } from './signature-search-columns.ts';
import { fromPosition, type SearchFilter, type SearchPage, searchConditions } from './signature-search-filter.ts';

// What the search for signatures reads (E15-S02). Every statement names the installation of the scope, so a signature of another
// tenant, one by the same GitHub user included, is never read; the documents and the repositories are joined on both keys. The
// statement writes nothing. The personal data (`signer_pii`) is read here because only a maintainer asks, and the route has judged
// the role before the statement runs.

/**
 * The signatures of the tenant, with the signer (`u`), the document `d` and the version in force `av` (absent when it has none),
 * the version signed (`v`), the personal data held for the signature (`p`, absent once erased), the repository signed from (`r`)
 * and who revoked it (`ru`). The paging is added by the caller.
 */
function signaturesOf(db: Kysely<Database>, scope: TenantScope) {
  return db
    .selectFrom('signatures as s')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 's.document_id').onRef('d.installation_id', '=', 's.installation_id'),
    )
    .innerJoin('users as u', 'u.id', 's.user_id')
    .innerJoin('cla_versions as v', 'v.id', 's.version_id')
    .leftJoin('cla_versions as av', (join) =>
      join.onRef('av.id', '=', 'd.active_version_id').onRef('av.document_id', '=', 'd.id'),
    )
    .leftJoin('signer_pii as p', 'p.signature_id', 's.id')
    .leftJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 's.source_repository_id').onRef('r.installation_id', '=', 's.installation_id'),
    )
    .leftJoin('users as ru', 'ru.id', 's.revoked_by')
    .select(SEARCH_COLUMNS)
    .select(SIGNED_AT_MICROS)
    .where('s.installation_id', '=', scope.installationId);
}

/**
 * The signatures of the tenant that `filter` takes, newest first (`signed_at desc, id desc`), from `page.from` on (that row
 * included) and one more than the page holds: that row is where the next page starts, and without it there is none. The caller
 * has seen that `filter.documentIds` is not empty.
 */
export function searchRows(db: Kysely<Database>, scope: TenantScope, filter: SearchFilter, page: SearchPage) {
  const { documentIds } = filter;
  const found = signaturesOf(db, scope).where((eb) => eb.and(searchConditions(filter)));
  const inDocuments = documentIds === null ? found : found.where('s.document_id', 'in', documentIds);
  const { from } = page;
  return (from === null ? inDocuments : inDocuments.where(fromPosition(from)))
    .orderBy('s.signed_at', 'desc')
    .orderBy('s.id', 'desc')
    .limit(page.limit + 1)
    .execute();
}

/** One row of {@link searchRows}. */
export type SearchRow = Awaited<ReturnType<typeof searchRows>>[number];
