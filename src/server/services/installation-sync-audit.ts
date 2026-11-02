// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { appendAudit } from './audit.ts';
import type { RepositoryChanges } from './repository-rows.ts';

// The audit rows of the repository half of a sync (E05-S08): one per repository change, in the transaction that made it.

/** The audit row of one repository change: the subject is the GitHub repository id, and no name is recorded. */
function appendRepositoryAudit(
  trx: Transaction<Database>,
  entry: {
    readonly action: 'repository.added' | 'repository.renamed' | 'repository.removed';
    readonly installationId: number;
    readonly githubRepoId: GithubId;
  },
): Promise<void> {
  return appendAudit(trx, {
    action: entry.action,
    installationId: entry.installationId,
    actorGithubId: null,
    subject: { type: 'repository', id: entry.githubRepoId },
    ...(entry.action === 'repository.removed' ? { metadata: { reason_code: 'not_listed' } } : {}),
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
    ...changes.removed.map((githubRepoId) => ({ action: 'repository.removed' as const, githubRepoId })),
  ];
  for (const row of rows) {
    await appendRepositoryAudit(trx, { ...row, installationId });
  }
}
