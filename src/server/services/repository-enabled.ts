// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { appendAudit } from './audit.ts';

/** The repository is not stored for this installation, or it is removed: there is nothing to turn on or off. */
export class RepositoryNotFoundError extends Error {
  override readonly name = 'RepositoryNotFoundError';

  constructor() {
    super('repository not found for this installation');
  }
}

/** One request to turn enforcement on or off for a repository of a tenant (E14-S03, E14-S04). */
export interface RepositoryEnabledChange {
  /** `installations.id`: the tenant. A repository stored under another installation is not found. */
  readonly installationId: InstallationRowId;
  readonly githubRepoId: GithubId;
  readonly enabled: boolean;
  /** The person who asked: the audit row names them by their numeric GitHub id. */
  readonly actorGithubId: GithubId;
}

/**
 * Sets `repositories.enabled` and appends the audit row `repository.enabled` or `repository.disabled` (subject
 * `repository`/GitHub repo id, metadata `repository_id`, plus `document_id` when enabling) in one transaction: the
 * caller's when `db` is one, else its own. The update is conditional on the current value, so of two concurrent calls
 * with the same value one changes the row and writes the audit row, and the other reports no change and writes none.
 * @returns `{ changed }`, false when the repository already had that value.
 * @throws RepositoryNotFoundError when the repository is unknown to the installation or removed.
 */
export function setRepositoryEnabled(
  db: Kysely<Database>,
  change: RepositoryEnabledChange,
): Promise<{ changed: boolean }> {
  return withTransaction(db, async (trx) => {
    const updated = await trx
      .updateTable('repositories')
      .set({ enabled: change.enabled, updated_at: sql`now()` })
      .where('installation_id', '=', change.installationId)
      .where('github_repo_id', '=', change.githubRepoId)
      .where('removed_at', 'is', null)
      .where('enabled', '=', !change.enabled)
      .returning(['id', 'cla_document_id'])
      .executeTakeFirst();
    if (updated === undefined) {
      const exists = await trx
        .selectFrom('repositories')
        .select('id')
        .where('installation_id', '=', change.installationId)
        .where('github_repo_id', '=', change.githubRepoId)
        .where('removed_at', 'is', null)
        .executeTakeFirst();
      if (exists === undefined) {
        throw new RepositoryNotFoundError();
      }
      return { changed: false };
    }
    await appendAudit(trx, {
      action: change.enabled ? 'repository.enabled' : 'repository.disabled',
      installationId: change.installationId,
      actorGithubId: change.actorGithubId,
      subject: { type: 'repository', id: change.githubRepoId },
      metadata: change.enabled
        ? { repository_id: updated.id, document_id: updated.cla_document_id }
        : { repository_id: updated.id },
    });
    return { changed: true };
  });
}
