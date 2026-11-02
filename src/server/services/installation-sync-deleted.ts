// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { appendAudit } from './audit.ts';
import { markInstallationDeleted } from './installation-queries.ts';
import type { InstallationRow } from './installation-state.ts';
import { accountTypeCode, type SyncContext, type SyncOutcome, untouched } from './installation-sync-model.ts';
import { listActiveRepositoryIds, markRepositoriesRemoved } from './repository-queries.ts';

// The uninstall step of a sync (E05-S08), run inside the installation step's transaction under the advisory lock.

/**
 * GitHub answered 404: the installation was uninstalled. A stored one is marked deleted together with all of its active
 * repositories and gets one `installation.deleted` audit row (the number of repositories is its `count`); every row
 * stays, signatures included. Nothing stored, or already deleted, is nothing to do.
 */
export async function markDeleted(
  ctx: SyncContext,
  trx: Transaction<Database>,
  stored: InstallationRow | null,
): Promise<SyncOutcome> {
  if (stored === null) {
    return untouched('unknown');
  }
  if (stored.deleted_at !== null) {
    return untouched('deleted');
  }
  const now = ctx.clock.now();
  await markInstallationDeleted(trx, stored.id, now);
  const removed = await markRepositoriesRemoved(trx, stored.id, await listActiveRepositoryIds(trx, stored.id), now);
  await appendAudit(trx, {
    action: 'installation.deleted',
    installationId: stored.id,
    actorGithubId: null,
    subject: { type: 'installation', id: stored.github_installation_id },
    metadata: {
      account_id: stored.account_id,
      account_type: accountTypeCode(stored.account_type),
      count: removed.length,
    },
  });
  return { status: 'deleted', changed: true, repositories: { added: 0, renamed: 0, removed: removed.length } };
}
