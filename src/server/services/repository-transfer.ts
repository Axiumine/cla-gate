// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { appendRepositoryAudit } from './repository-audit.ts';
import { batches } from './repository-rows.ts';

// The transfer of a repository between two tenants of this server (E05-S09). It is the one place where a sync writes a
// row that is not its own installation's.

/**
 * A repository the installation `installationId` (`installations.id`) lists is still active under another installation:
 * GitHub says it belongs here now, so the other tenant's row is marked removed, which is what that tenant's own sync
 * would find on its next run. The same statement and the same transaction as the insert of this tenant's row follow, so
 * the partial unique index (a repository is active under one installation) is never violated. Each released row gets
 * its `repository.removed` audit row (`reason_code` `transferred`) under the tenant that lost it.
 *
 * The write is as narrow as it can be. It sets `removed_at` and nothing else: not `updated_at`, not `enabled`, not the
 * document, and no row that points at the repository (signatures, evaluations, allowlist, overrides) is read or written,
 * so the old tenant keeps all of it, immutable. Only an id in `githubRepoIds` can be released, and the caller passes
 * nothing but what GitHub listed for its own installation; a row already removed is left alone, so a repository that
 * moved earlier, or that the old tenant's sync removed first, is released by nobody.
 *
 * Another tenant's sync may remove the same row at the same time. The statement is conditional on `removed_at is null`,
 * so one of the two writes it and audits it, and the other finds nothing to do.
 */
export async function releaseTransferred(
  trx: Transaction<Database>,
  installationId: number,
  githubRepoIds: readonly GithubId[],
  removedAt: Date,
): Promise<void> {
  for (const batch of batches(githubRepoIds)) {
    const released = await trx
      .updateTable('repositories')
      .set({ removed_at: removedAt })
      .where('github_repo_id', 'in', batch)
      .where('installation_id', '<>', installationId)
      .where('removed_at', 'is', null)
      .returning(['installation_id', 'github_repo_id'])
      .execute();
    for (const row of released) {
      await appendRepositoryAudit(trx, {
        action: 'repository.removed',
        installationId: row.installation_id,
        githubRepoId: parseGithubId(row.github_repo_id),
        reasonCode: 'transferred',
      });
    }
  }
}
