// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { markInstallationSynced } from './installation-queries.ts';
import { auditRepositoryChanges } from './installation-sync-audit.ts';
import type { SyncContext, SyncOutcome } from './installation-sync-model.ts';
import type { GitHubRepository } from './ports/github.ts';
import { listActiveRepositoryIds, markRepositoriesRemoved } from './repository-queries.ts';
import { upsertRepositories } from './repository-upsert.ts';

// The writes of the repository half of a sync (E05-S08), inside the caller's transaction.

/**
 * Stores the listed repositories (new ones with `enabled = false`, known ones with a fresh `full_name`, removed ones
 * brought back), then marks the active ones that are no longer listed as removed. A repository that is active under another installation
 * makes the whole write fail with a unique violation and changes nothing (moving a repository between tenants is E05-S09).
 */
export async function reconcile(
  ctx: SyncContext,
  trx: Transaction<Database>,
  installationId: number,
  listed: readonly GitHubRepository[],
): Promise<SyncOutcome> {
  const snapshots = listed.map((repository) => ({ githubRepoId: repository.id, fullName: repository.fullName }));
  const now = ctx.clock.now();
  const { added, renamed } = await upsertRepositories(trx, installationId, snapshots);
  const listedIds = new Set(snapshots.map((snapshot) => snapshot.githubRepoId));
  const missing = (await listActiveRepositoryIds(trx, installationId)).filter(
    (githubRepoId) => !listedIds.has(githubRepoId),
  );
  const removed = await markRepositoriesRemoved(trx, installationId, missing, now);
  await auditRepositoryChanges(trx, installationId, { added, renamed, removed });
  const changed = added.length + renamed.length + removed.length > 0;
  if (changed) {
    await markInstallationSynced(trx, installationId, now);
  }
  return {
    status: 'synced',
    changed,
    repositories: { added: added.length, renamed: renamed.length, removed: removed.length },
  };
}
