// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statements over the ledger of org admins (E11-S07, migration 007). Every one names the installation, so an entry of
// another tenant is never read, refreshed or deleted; the person is a numeric GitHub id and belongs to no tenant, which is
// why the same person can hold an entry in each of several tenants.

/** When a live lookup saw an admin, and how old an entry may be and still be moved up to that instant. */
export interface Sighting {
  readonly seenAt: Date;
  readonly refreshAtOrBefore: Date;
}

/**
 * Notes that the person was seen as an admin of the organisation at `sighting.seenAt`. A new entry is inserted; an entry
 * seen at or before `sighting.refreshAtOrBefore` is moved up to `seenAt`; a fresher one is left alone, so a pair is written
 * at most once per interval and an entry never moves back in time. Resolves to whether a row was written.
 */
export async function recordAdminSeen(
  db: Kysely<Database>,
  scope: TenantScope,
  person: GithubId,
  sighting: Sighting,
): Promise<boolean> {
  const written = await db
    .insertInto('installation_admin_seen')
    .values({ installation_id: scope.installationId, user_github_id: person, seen_at: sighting.seenAt })
    .onConflict((conflict) =>
      conflict
        .columns(['installation_id', 'user_github_id'])
        .doUpdateSet({ seen_at: sighting.seenAt })
        .where('installation_admin_seen.seen_at', '<=', sighting.refreshAtOrBefore),
    )
    .returning('user_github_id')
    .executeTakeFirst();
  return written !== undefined;
}

/** Deletes the entry of the person in this tenant, if there is one. Resolves to whether one was deleted. */
export async function forgetAdminSeen(db: Kysely<Database>, scope: TenantScope, person: GithubId): Promise<boolean> {
  const deleted = await db
    .deleteFrom('installation_admin_seen')
    .where('installation_id', '=', scope.installationId)
    .where('user_github_id', '=', person)
    .returning('user_github_id')
    .executeTakeFirst();
  return deleted !== undefined;
}

/** Whether this tenant holds an entry for the person that was seen at or after `since`. */
export async function wasAdminSeenSince(
  db: Kysely<Database>,
  scope: TenantScope,
  person: GithubId,
  since: Date,
): Promise<boolean> {
  const entry = await db
    .selectFrom('installation_admin_seen')
    .select('user_github_id')
    .where('installation_id', '=', scope.installationId)
    .where('user_github_id', '=', person)
    .where('seen_at', '>=', since)
    .executeTakeFirst();
  return entry !== undefined;
}
