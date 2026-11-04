// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { AllowlistKind } from './allowlist-entry-types.ts';

// The statements that find and remove an allowlist entry (E14-S07). Both name the installation in the WHERE clause next to the entry
// id, so an entry of another tenant is never found nor removed. The statement that adds one is in allowlist-entry-queries.ts.

/** An entry as the removal needs it: what it covers, what the audit row says about it, and whether its repository has left the installation. */
export interface FoundEntry {
  readonly id: number;
  /** `repositories.id`, or null for an entry that covers the installation. */
  readonly repositoryId: number | null;
  /** When the repository of the entry was removed from the installation (the entry stays), or null. */
  readonly repositoryRemovedAt: Date | null;
  readonly kind: AllowlistKind;
  readonly githubId: GithubId;
}

/**
 * The entry `entryId` of the tenant, or undefined when the tenant has none: `where e.installation_id = $1 and e.id = $2`, so
 * another tenant's entry, an unknown one and one that was removed are the same answer. The repository is read in any state, because
 * an entry outlives the repository's removal.
 */
export async function findAllowlistEntry(
  db: Kysely<Database>,
  scope: TenantScope,
  entryId: number,
): Promise<FoundEntry | undefined> {
  const row = await db
    .selectFrom('allowlist_entries as e')
    .leftJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 'e.repository_id').onRef('r.installation_id', '=', 'e.installation_id'),
    )
    .select(['e.id', 'e.repository_id', 'e.kind', 'e.github_id', 'r.removed_at'])
    .where('e.installation_id', '=', scope.installationId)
    .where('e.id', '=', entryId)
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : {
        id: row.id,
        repositoryId: row.repository_id,
        repositoryRemovedAt: row.removed_at,
        kind: row.kind,
        githubId: parseGithubId(row.github_id),
      };
}

/**
 * Removes the entry `entryId` of the tenant for good (the history is the audit row, not the table).
 * @returns whether a row was removed: false when the tenant has no such entry, which is also what the loser of two simultaneous
 * removals finds after the winner committed.
 */
export async function deleteAllowlistEntry(
  trx: Transaction<Database>,
  scope: TenantScope,
  entryId: number,
): Promise<boolean> {
  const row = await trx
    .deleteFrom('allowlist_entries')
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', entryId)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}
