// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statement that adds an allowlist entry (E14-S06). It names the installation in the row it writes, and the composite foreign
// key `(repository_id, installation_id)` of migration 001 refuses a repository of another tenant behind that. The entry is the
// numeric GitHub id of the account: matching reads `github_id` and nothing else, and `login_snapshot` is a display snapshot.

/** An entry to store. */
export interface NewEntryRow {
  /** `repositories.id`, or null for an entry that covers the installation. */
  readonly repositoryId: number | null;
  readonly kind: 'user' | 'bot' | 'org_members';
  readonly githubId: GithubId;
  /** The login to show, or null. Never used for matching. */
  readonly loginSnapshot: string | null;
  /** `users.id` of the person who adds it. */
  readonly createdBy: number;
}

/** The part of the stored row the database decides. */
interface StoredEntryRow {
  readonly id: number;
  readonly createdAt: Date;
}

/**
 * Stores the entry unless the tenant has it already: the unique key is (installation, repository, kind, GitHub id) with the null of
 * an installation-wide entry counting as equal to another, so the same account may be listed once for the installation and once
 * per repository. Two simultaneous adds of one entry store it once: the second waits for the first to commit and finds it.
 * @returns the id and the time of the new row, or undefined when the entry exists.
 */
export async function insertAllowlistEntry(
  trx: Transaction<Database>,
  scope: TenantScope,
  entry: NewEntryRow,
): Promise<StoredEntryRow | undefined> {
  const row = await trx
    .insertInto('allowlist_entries')
    .values({
      installation_id: scope.installationId,
      repository_id: entry.repositoryId,
      kind: entry.kind,
      github_id: entry.githubId,
      login_snapshot: entry.loginSnapshot,
      created_by: entry.createdBy,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning(['id', 'created_at'])
    .executeTakeFirst();
  return row === undefined ? undefined : { id: row.id, createdAt: row.created_at };
}
