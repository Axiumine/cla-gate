// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { removeAllowlistEntry } from '../allowlist-entry-remove.ts';
import type { EntryRemoval } from '../allowlist-entry-types.ts';
import { publishWorld } from '../publish-fixture/test-support.ts';

// The world of the tests that remove allowlist entries below the routes (E14-S07): the publish world (two tenants, the entries each
// seeds) and the calls and looks the tests share.

/** Two tenants as the publish world seeds them, and the removal of entries of tenant 1 by its org admin unless `over` says otherwise. */
export async function removalWorld() {
  const base = await publishWorld();
  const { db, t1, admin, scope, enqueuer } = base;
  const deps = { db, enqueuer };
  /** A removal by an org admin of tenant 1, unless `over` says otherwise. */
  const request = (entryId: number, over: Partial<EntryRemoval> = {}): EntryRemoval => ({
    entryId,
    role: 'org_admin',
    actorGithubId: admin.githubId,
    ...over,
  });
  const run = (entryId: number, over: Partial<EntryRemoval> = {}) =>
    removeAllowlistEntry(deps, scope, request(entryId, over));
  /** The id of the entry of the tenant for a repository of it: the world seeds one for the plain repository (GitHub id `n * 100 + 1`). */
  const repositoryEntry = async (githubId: number) =>
    (await db.selectFrom('allowlist_entries').select('id').where('github_id', '=', githubId).executeTakeFirstOrThrow())
      .id;
  /** Stores an entry of the repository `repositoryId` of tenant 1 for the tests to remove; its id. */
  const entryFor = async (repositoryId: number) =>
    (
      await db
        .insertInto('allowlist_entries')
        .values({
          installation_id: t1.installationId,
          repository_id: repositoryId,
          kind: 'user',
          github_id: 6001,
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  const remaining = async () => (await db.selectFrom('allowlist_entries').select('id').execute()).map((row) => row.id);
  const audited = async () =>
    (await db.selectFrom('audit_log').select('id').where('action', '=', 'allowlist_entry.deleted').execute()).length;
  return { ...base, deps, run, repositoryEntry, entryFor, remaining, audited };
}
