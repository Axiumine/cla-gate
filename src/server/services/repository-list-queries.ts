// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { type RepositoryEntry, type RepositoryPosition, toEntry } from './repository-entry.ts';

// The statements that read the repositories of a tenant for its list (E14-S01). Every one names the installation in its WHERE
// clause, so a repository of another tenant is never read; a removed repository is never listed. The document a repository
// enforces and its active version are joined on both keys, so they are the tenant's own.

/** What a read of the list is asked for. */
export interface RepositoryRead {
  /** At most this many rows. */
  readonly limit: number;
  /** The first row, included, or null for the start of the list. */
  readonly from: RepositoryPosition | null;
  /** A substring of the full name, any case, taken literally. Null for none. */
  readonly q: string | null;
  /** Only the repositories that do (true) or do not (false) enforce the CLA; null for both. */
  readonly enabled: boolean | null;
  /** Only the repositories that carry a repo-scoped CLA document (the ones a repository admin can be found through, E11-S03). */
  readonly withRepositoryDocument: boolean;
}

/**
 * A pattern that matches `text` as it is written, anywhere in a value: `%`, `_` and the escape character itself lose their
 * meaning, so `q=%` finds the names that have a percent sign and not all of them.
 */
function containing(text: string): string {
  return `%${text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

/** The repositories of the tenant that are not removed, with the document each enforces, in the order `full_name asc, id asc`. */
function selectEntries(db: Kysely<Database>, scope: TenantScope) {
  return db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .leftJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 'r.cla_document_id').onRef('d.installation_id', '=', 'r.installation_id'),
    )
    .leftJoin('cla_versions as v', (join) =>
      join.onRef('v.id', '=', 'd.active_version_id').onRef('v.document_id', '=', 'd.id'),
    )
    .select([
      'r.id',
      'r.github_repo_id',
      'r.full_name',
      'r.enabled',
      'i.github_installation_id',
      'd.id as document_id',
      'd.name as document_name',
      'd.repository_id as document_repository_id',
      'v.major',
      'v.minor',
    ])
    .where('r.installation_id', '=', scope.installationId)
    .where('r.removed_at', 'is', null)
    .orderBy('r.full_name')
    .orderBy('r.id');
}

/**
 * Up to `read.limit` repositories of the tenant from `read.from` on, in the order `full_name asc, id asc`, narrowed by the
 * filters of `read`. The position is compared as the pair (full name, id), so no repository is skipped or repeated between
 * pages. A repository counts as carrying a repo-scoped document when a document of the same tenant is scoped to it.
 */
export async function listRepositoryEntries(
  db: Kysely<Database>,
  scope: TenantScope,
  read: RepositoryRead,
): Promise<RepositoryEntry[]> {
  const { from, q, enabled } = read;
  let query = selectEntries(db, scope);
  if (from !== null) {
    query = query.where(sql<boolean>`(r.full_name, r.id) >= (${from.fullName}, ${from.id})`);
  }
  if (q !== null) {
    query = query.where(sql<boolean>`r.full_name ilike ${containing(q)} escape '\\'`);
  }
  if (enabled !== null) {
    query = query.where('r.enabled', '=', enabled);
  }
  if (read.withRepositoryDocument) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('cla_documents as own')
          .select('own.id')
          .whereRef('own.repository_id', '=', 'r.id')
          .where('own.installation_id', '=', scope.installationId),
      ),
    );
  }
  const rows = await query.limit(read.limit).execute();
  return rows.map(toEntry);
}
