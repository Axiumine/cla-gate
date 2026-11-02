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

/** One WARN line naming the permissions that fall short of the minimum; the sync carries on. */
export function warnMissingPermissions(ctx: SyncContext, remote: GitHubInstallation): void {
  const missing = missingPermissions(remote.permissions);
  if (missing.length > 0) {
    ctx.logger.warn({ githubInstallationId: remote.id, permissions: missing }, 'installation.permissions_missing');
  }
}
