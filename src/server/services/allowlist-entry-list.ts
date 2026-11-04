// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { Role } from '../domain/authz.ts';
import { judgedRepositoryRead, requireOrgAdmin } from './allowlist-entry-checks.ts';
import { type EntryWithin, listAllowlistEntries } from './allowlist-entry-list-queries.ts';
import type {
  EntryPage,
  EntryPageRequest,
  EntryPosition,
  ListedEntry,
  RepositoryEntryFrom,
  RepositoryEntryPage,
} from './allowlist-entry-types.ts';

// The lists of the allowlist (E14-S07): what exempts accounts for the whole installation, and for one repository what it has of its
// own and what it inherits from the installation. Read only. The statement is in allowlist-entry-list-queries.ts; the role is judged
// here, by the same rules as the changes of the list (allowlist-entry-checks.ts).

/** Where a page after `entry` starts: its `kind`, its login (null when it has none) and its id. */
function positionOf(entry: ListedEntry): EntryPosition {
  return { kind: entry.kind, loginSnapshot: entry.loginSnapshot, id: entry.id };
}

/**
 * A page of what `within` names: `page.limit` entries (none when the limit is 0, which only asks whether anything follows) from
 * `page.from`. One entry more than the page is read: it tells whether more follow, and it is where the next page starts.
 */
async function pageOf(
  db: Kysely<Database>,
  scope: TenantScope,
  within: EntryWithin,
  page: EntryPageRequest,
): Promise<EntryPage> {
  const rows = await listAllowlistEntries(db, scope, within, { limit: page.limit + 1, from: page.from });
  const following = rows[page.limit];
  return { entries: rows.slice(0, page.limit), next: following === undefined ? null : positionOf(following) };
}

/**
 * A page of the entries that cover the whole installation, `kind asc, login_snapshot asc nulls last, id asc`. The person must be an
 * org admin.
 * @throws ClaRuleError `forbidden`.
 */
export async function listInstallationAllowlist(
  db: Kysely<Database>,
  scope: TenantScope,
  request: { readonly role: Role } & EntryPageRequest,
): Promise<EntryPage> {
  requireOrgAdmin(request.role);
  return pageOf(db, scope, { repositoryId: null }, request);
}

/**
 * A page of the allowlist of one repository: its own entries first, then the entries of the installation it inherits, each in the
 * order of the list of the installation. The page holds `limit` entries at most in all; `next` is where the following page starts,
 * which can be the first inherited entry when the own ones filled this page exactly. The person needs the role the repository-action
 * rule asks for the document the repository enforces.
 * @throws ClaRuleError `forbidden`, or `not_found` for a repository that left the tenant since the guard read it.
 */
export async function listRepositoryAllowlist(
  db: Kysely<Database>,
  scope: TenantScope,
  request: {
    readonly repositoryId: number;
    readonly role: Role;
    readonly limit: number;
    readonly from: RepositoryEntryFrom | null;
  },
): Promise<RepositoryEntryPage> {
  const { repositoryId, limit, from } = request;
  await judgedRepositoryRead(db, scope, request);
  const own =
    from?.section === 'inherited'
      ? { entries: [], next: null }
      : await pageOf(db, scope, { repositoryId }, { limit, from: from?.position ?? null });
  if (own.next !== null) {
    return { own: own.entries, inherited: [], next: { section: 'own', position: own.next } };
  }
  const inherited = await pageOf(
    db,
    scope,
    { repositoryId: null },
    { limit: limit - own.entries.length, from: from?.section === 'inherited' ? from.position : null },
  );
  return {
    own: own.entries,
    inherited: inherited.entries,
    next: inherited.next === null ? null : { section: 'inherited', position: inherited.next },
  };
}
