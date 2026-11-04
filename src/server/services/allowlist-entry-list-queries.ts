// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { EntryPageRequest, EntryPosition, ListedEntry } from './allowlist-entry-types.ts';

// The statement that reads the allowlist of a tenant for its lists (E14-S07). It names the installation in its WHERE clause, so an
// entry of another tenant is never read, and joins the person who made the entry on the foreign key, so the login it shows is the
// one the `users` row holds. The order is `kind asc, login_snapshot asc nulls last, id asc`; the id is unique, so the order is total
// and no entry is skipped or repeated between pages.

/** What a list covers: the entries of one repository, or (null) the entries that cover the whole installation. */
export interface EntryWithin {
  /** `repositories.id`, or null for the entries of the installation itself. */
  readonly repositoryId: number | null;
}

/**
 * The condition that keeps the entries at `position` and after it in the order of the lists. The three values are compared as one
 * key, written out because the login can be null and the nulls come last: after the login of the position come the entries with
 * none, and an entry with none is followed by the entries with none only.
 */
function atOrAfter(position: EntryPosition) {
  const { kind, loginSnapshot, id } = position;
  if (loginSnapshot === null) {
    return sql<boolean>`(e.kind > ${kind} or (e.kind = ${kind} and e.login_snapshot is null and e.id >= ${id}))`;
  }
  return sql<boolean>`(
    e.kind > ${kind}
    or (e.kind = ${kind} and (
      e.login_snapshot > ${loginSnapshot}
      or e.login_snapshot is null
      or (e.login_snapshot = ${loginSnapshot} and e.id >= ${id})
    ))
  )`;
}

/** The entries of the tenant that `within` names, with who made each, before ordering and paging. */
function selectEntries(db: Kysely<Database>, scope: TenantScope, within: EntryWithin) {
  const all = db
    .selectFrom('allowlist_entries as e')
    .innerJoin('users as u', 'u.id', 'e.created_by')
    .select([
      'e.id',
      'e.repository_id',
      'e.kind',
      'e.github_id',
      'e.login_snapshot',
      'e.created_at',
      'u.github_id as created_by_github_id',
      'u.login as created_by_login',
    ])
    .where('e.installation_id', '=', scope.installationId);
  return within.repositoryId === null
    ? all.where('e.repository_id', 'is', null)
    : all.where('e.repository_id', '=', within.repositoryId);
}

/**
 * Up to `page.limit` entries of the tenant that `within` names, from `page.from` (that entry included) when it is given, in the order
 * `kind asc, login_snapshot asc nulls last, id asc`. An entry of another tenant, and a repository of another tenant, find nothing.
 */
export async function listAllowlistEntries(
  db: Kysely<Database>,
  scope: TenantScope,
  within: EntryWithin,
  page: EntryPageRequest,
): Promise<ListedEntry[]> {
  const { from } = page;
  const all = selectEntries(db, scope, within);
  const rows = await (from === null ? all : all.where(atOrAfter(from)))
    .orderBy('e.kind')
    .orderBy(sql`e.login_snapshot asc nulls last`)
    .orderBy('e.id')
    .limit(page.limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    scope: row.repository_id === null ? 'installation' : 'repository',
    repositoryId: row.repository_id,
    kind: row.kind,
    githubId: parseGithubId(row.github_id),
    loginSnapshot: row.login_snapshot,
    createdBy: { githubId: parseGithubId(row.created_by_github_id), login: row.created_by_login },
    createdAt: row.created_at,
  }));
}
