// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { missingPermissions } from '../domain/permissions.ts';
import { appendAudit } from './audit.ts';
import { accountTypeCode, type InstallationRow } from './installation-state.ts';
import type { SyncContext } from './installation-sync-model.ts';
import type { GitHubInstallation } from './ports/github.ts';

// What a sync notes about an installation GitHub has, besides the account snapshot and the admission decision (E05-S08).

/** Appends `installation.suspended` or `installation.unsuspended` when the suspension differs from the stored one. */
export async function recordSuspension(
  trx: Transaction<Database>,
  row: InstallationRow,
  wasSuspended: boolean,
  remote: GitHubInstallation,
): Promise<boolean> {
  const isSuspended = remote.suspendedAt !== null;
  if (wasSuspended === isSuspended) {
    return false;
  }
  await appendAudit(trx, {
    action: isSuspended ? 'installation.suspended' : 'installation.unsuspended',
    installationId: row.id,
    actorGithubId: null,
    subject: { type: 'installation', id: remote.id },
    metadata: { account_id: remote.account.id, account_type: accountTypeCode(remote.account.type) },
  });
  return true;
}

/** A suspension that stays but carries another time: it was lifted and set again between two syncs. */
const suspensionMoved = (stored: Date | null, remote: Date | null): boolean =>
  stored !== null && remote !== null && stored.getTime() !== remote.getTime();

/**
 * The snapshot of a stored installation changed in a way no other audit row of the sync tells: the account, its login or
 * its type, or the time of a suspension that stays (it was lifted and set again between two syncs). A suspension that
 * starts or ends has its own row.
 */
export function snapshotRefreshed(stored: InstallationRow, remote: GitHubInstallation): boolean {
  return (
    stored.account_id !== remote.account.id ||
    stored.account_login !== remote.account.login ||
    stored.account_type !== remote.account.type ||
    suspensionMoved(stored.suspended_at, remote.suspendedAt)
  );
}

/** Appends `installation.updated`: numeric account id and type code only, never the login. */
export async function recordRefresh(
  trx: Transaction<Database>,
  row: InstallationRow,
  remote: GitHubInstallation,
): Promise<void> {
  await appendAudit(trx, {
    action: 'installation.updated',
    installationId: row.id,
    actorGithubId: null,
    subject: { type: 'installation', id: remote.id },
    metadata: { account_id: remote.account.id, account_type: accountTypeCode(remote.account.type) },
  });
}

/** One WARN line naming the permissions that fall short of the minimum; the sync carries on. */
export function warnMissingPermissions(ctx: SyncContext, remote: GitHubInstallation): void {
  const missing = missingPermissions(remote.permissions);
  if (missing.length > 0) {
    ctx.logger.warn({ githubInstallationId: remote.id, permissions: missing }, 'installation.permissions_missing');
  }
}
