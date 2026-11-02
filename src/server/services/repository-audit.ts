// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { appendAudit } from './audit.ts';
import type { RepositoryChanges } from './repository-rows.ts';

// The audit rows of the repository changes (E05-S08, E05-S09): one per change, in the transaction that made it. The
// subject is the GitHub repository id and no name is recorded, because names stay out of the audit log.

/**
 * Why a repository was removed, as `reason_code` records it.
 * - `not_listed`: the sync (E05-S08) found it missing from GitHub's list for the installation.
 * - `access_lost`: GitHub answered 404 or 403 when the snapshot was refreshed (E05-S09).
 * - `transferred`: another installation lists it now (E05-S09); written under the tenant that lost it.
 */
export type RemovalReason = 'not_listed' | 'access_lost' | 'transferred';

/** The audit row of one repository change. `reasonCode` is for a removal. */
export function appendRepositoryAudit(
  trx: Transaction<Database>,
  entry: {
    readonly action: 'repository.added' | 'repository.renamed' | 'repository.removed';
    readonly installationId: number;
    readonly githubRepoId: GithubId;
    readonly reasonCode?: RemovalReason;
  },
): Promise<void> {
  return appendAudit(trx, {
    action: entry.action,
    installationId: entry.installationId,
    actorGithubId: null,
    subject: { type: 'repository', id: entry.githubRepoId },
    ...(entry.reasonCode === undefined ? {} : { metadata: { reason_code: entry.reasonCode } }),
  });
}

export async function auditRepositoryChanges(
  trx: Transaction<Database>,
  installationId: number,
  changes: RepositoryChanges & { readonly removed: readonly GithubId[] },
): Promise<void> {
  const rows = [
    ...changes.added.map((githubRepoId) => ({ action: 'repository.added' as const, githubRepoId })),
    ...changes.renamed.map((githubRepoId) => ({ action: 'repository.renamed' as const, githubRepoId })),
    ...changes.removed.map((githubRepoId) => ({
      action: 'repository.removed' as const,
      githubRepoId,
      reasonCode: 'not_listed' as const,
    })),
  ];
  for (const row of rows) {
    await appendRepositoryAudit(trx, { ...row, installationId });
  }
}
