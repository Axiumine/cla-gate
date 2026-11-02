// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import { lockInstallation } from '../adapters/db/advisory-lock.ts';
import type { Database } from '../adapters/db/schema.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { findInstallationByGithubId, upsertInstallation } from './installation-queries.ts';
import type { InstallationRow } from './installation-state.ts';
import { recordSuspension, warnMissingPermissions } from './installation-sync-checks.ts';
import { markDeleted } from './installation-sync-deleted.ts';
import { type SyncContext, type SyncOutcome, type SyncStatus, untouched } from './installation-sync-model.ts';
import type { GitHubInstallation } from './ports/github.ts';

// The installation half of a sync (E05-S08), in one transaction under the installation's advisory lock: the uninstall,
// the account snapshot, the admission decision and a suspension. It never calls GitHub: the caller fetched `remote`
// before, so no database connection is held while a request is out. Every state change has an audit row in the same
// transaction, and a run over unchanged state writes nothing.

/** What the installation step found; `repositoriesOf` is the stored installation (`installations.id`) whose repositories are next. */
export interface StateStep {
  readonly outcome: SyncOutcome;
  /** Set only for an admitted, active installation: the sync goes on to list its repositories. */
  readonly repositoriesOf?: number;
}

const ended = (outcome: SyncOutcome): StateStep => ({ outcome });

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

/** The stored snapshot is not what GitHub says now. The account id is the identity of the row and is compared too. */
const snapshotDiffers = (stored: InstallationRow, remote: GitHubInstallation): boolean =>
  stored.account_id !== remote.account.id ||
  stored.account_login !== remote.account.login ||
  stored.account_type !== remote.account.type ||
  !sameInstant(stored.suspended_at, remote.suspendedAt);

function statusOf(admitted: boolean, remote: GitHubInstallation): SyncStatus {
  if (!admitted) {
    return 'rejected';
  }
  return remote.suspendedAt === null ? 'synced' : 'suspended';
}

/**
 * Steps 2 and 3 for an installation GitHub has: the account snapshot, written only when it differs, then the admission
 * decision of E05-S07 (which writes and audits only a change of decision), then the suspension. A rejected installation
 * ends here, and so does a suspended one; the repositories are next only for an admitted, active installation.
 */
async function applyRemote(
  ctx: SyncContext,
  trx: Transaction<Database>,
  stored: InstallationRow | null,
  remote: GitHubInstallation,
): Promise<StateStep> {
  const now = ctx.clock.now();
  const snapshotChanged = stored === null || snapshotDiffers(stored, remote);
  if (snapshotChanged) {
    await upsertInstallation(trx, {
      githubInstallationId: remote.id,
      accountId: remote.account.id,
      accountLogin: remote.account.login,
      accountType: remote.account.type,
      suspendedAt: remote.suspendedAt,
      lastSyncedAt: now,
    });
  }
  const decision = await ctx.admission.admit(remote, trx);
  const wasSuspended = stored !== null && stored.suspended_at !== null;
  const suspensionChanged = await recordSuspension(trx, decision.installation, wasSuspended, remote);
  if (decision.admitted) {
    warnMissingPermissions(ctx, remote);
  }
  const status = statusOf(decision.admitted, remote);
  const outcome = { ...untouched(status), changed: snapshotChanged || decision.changed || suspensionChanged };
  return status === 'synced' ? { outcome, repositoriesOf: decision.installation.id } : ended(outcome);
}

/**
 * Applies what GitHub said about the installation (`remote`, null for a 404) to the stored state, in one transaction under
 * the installation's advisory lock.
 */
export function syncInstallationState(
  ctx: SyncContext,
  githubInstallationId: GithubId,
  remote: GitHubInstallation | null,
): Promise<StateStep> {
  return withTransaction(ctx.db, async (trx) => {
    await lockInstallation(trx, githubInstallationId);
    const stored = await findInstallationByGithubId(trx, githubInstallationId);
    if (remote === null) {
      return ended(await markDeleted(ctx, trx, stored));
    }
    if (stored !== null && stored.deleted_at !== null) {
      // GitHub never reuses an installation id, so this is not a reinstall; the row stays deleted.
      ctx.logger.warn({ githubInstallationId }, 'installation.deleted_still_listed');
      return ended(untouched('deleted'));
    }
    return await applyRemote(ctx, trx, stored, remote);
  });
}
