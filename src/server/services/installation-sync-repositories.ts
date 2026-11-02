// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { lockInstallation } from '../adapters/db/advisory-lock.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { type InstallationIneligibleReason, installationEligibility } from '../domain/eligibility.ts';
import { getInstallationById } from './installation-queries.ts';
import { type SyncContext, type SyncOutcome, type SyncStatus, untouched } from './installation-sync-model.ts';
import { reconcile } from './installation-sync-write.ts';
import type { GitHubRepository } from './ports/github.ts';

// The repository half of a sync (E05-S08): GitHub's list is the truth, and the stored rows are brought in line with it in
// one transaction under the installation's advisory lock, together with one audit row per change. The list is fetched
// before the transaction opens, so a listing that fails changes nothing and no connection waits on GitHub.

/** Why the installation was left alone when the lock was taken: what changed between the two steps of the sync. */
const STATUS_OF: Readonly<Record<InstallationIneligibleReason, SyncStatus>> = {
  installation_rejected: 'rejected',
  installation_deleted: 'deleted',
  installation_suspended: 'suspended',
};

/**
 * Reconciles the repositories of the stored installation `installationId` (`installations.id`, `githubInstallationId` its
 * GitHub id) with the list GitHub gave for it. The installation is read again under the lock and the work is skipped when
 * it is no longer one the instance serves (another run rejected, suspended or uninstalled it since the list was
 * fetched), so a slow listing cannot write into a tenant that has been closed.
 */
export function syncRepositories(
  ctx: SyncContext,
  installation: { readonly installationId: InstallationRowId; readonly githubInstallationId: GithubId },
  listed: readonly GitHubRepository[],
): Promise<SyncOutcome> {
  return withTransaction(ctx.db, async (trx) => {
    await lockInstallation(trx, installation.githubInstallationId);
    const row = await getInstallationById(trx, installation.installationId);
    const served = installationEligibility({
      admissionStatus: row.admission_status,
      deletedAt: row.deleted_at,
      suspendedAt: row.suspended_at,
    });
    return served.eligible ? await reconcile(ctx, trx, row.id, listed) : untouched(STATUS_OF[served.reason]);
  });
}
