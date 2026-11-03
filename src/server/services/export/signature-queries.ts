// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import { filterConditions, type SignatureFilter } from './signature-filter.ts';

// What the signature export reads (E16-S03). Every statement names the installation of the scope and the document, so a
// signature of another tenant, including one by the same GitHub user, is never read. Nothing here writes.

/** Where a batch starts and how long it is: the keyset the export pages by. */
export interface KeysetPage {
  /** The batch holds the signatures with an id above this one. */
  readonly afterId: number;
  readonly limit: number;
}

/** The signatures of the filter in the tenant, with their document `d` and its active version `av`. The rest is added by the callers. */
function filtered(db: Kysely<Database>, scope: TenantScope, filter: SignatureFilter) {
  return db
    .selectFrom('signatures as s')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 's.document_id').onRef('d.installation_id', '=', 's.installation_id'),
    )
    .leftJoin('cla_versions as av', (join) =>
      join.onRef('av.id', '=', 'd.active_version_id').onRef('av.document_id', '=', 'd.id'),
    )
    .where('s.installation_id', '=', scope.installationId)
    .where('s.document_id', '=', filter.documentId)
    .where((eb) => eb.and(filterConditions(filter)));
}

/** How many signatures the filter takes, as the reading `db` sees them: inside a snapshot, the snapshot's. */
export async function countSignatures(
  db: Kysely<Database>,
  scope: TenantScope,
  filter: SignatureFilter,
): Promise<number> {
  const { count } = await filtered(db, scope, filter)
    .select(sql<number>`count(*)`.as('count'))
    .executeTakeFirstOrThrow();
  return count;
}

/**
 * The signatures of the filter in the tenant that `page` asks for (at most `page.limit`, all with an id above `page.afterId`), in
 * the order of the id: the keyset the export pages by. Each row carries the person (`u`), the version signed (`v`), the repository the person signed from (`r`), who revoked
 * it (`ru`) and the personal data held for it (`p`), which is absent once erased.
 */
export function signatureBatch(db: Kysely<Database>, scope: TenantScope, filter: SignatureFilter, page: KeysetPage) {
  return filtered(db, scope, filter)
    .innerJoin('users as u', 'u.id', 's.user_id')
    .innerJoin('cla_versions as v', 'v.id', 's.version_id')
    .leftJoin('signer_pii as p', 'p.signature_id', 's.id')
    .leftJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 's.source_repository_id').onRef('r.installation_id', '=', 's.installation_id'),
    )
    .leftJoin('users as ru', 'ru.id', 's.revoked_by')
    .select([
      's.id as signature_id',
      'u.github_id as github_user_id',
      'p.login as pii_login',
      'p.name as pii_name',
      'p.email as pii_email',
      'd.id as document_id',
      'd.name as document_name',
      's.major as version_major',
      'v.minor as version_minor',
      's.content_sha256',
      's.consent_text_id',
      's.signer_type',
      's.signed_at',
      'r.full_name as source_repository',
      's.source_pr_number',
      's.revoked_at',
      'ru.github_id as revoked_by_github_id',
      's.revoke_reason',
      'av.major as active_major',
    ])
    .select(sql<boolean>`p.signature_id is null`.as('pii_erased'))
    .where('s.id', '>', page.afterId)
    .orderBy('s.id')
    .limit(page.limit)
    .execute();
}

/** One row of {@link signatureBatch}. */
export type SignatureBatchRow = Awaited<ReturnType<typeof signatureBatch>>[number];
