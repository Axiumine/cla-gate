// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { enqueueSweepRepository } from './repository-job-enqueue.ts';

// The re-evaluation a change of the allowlist asks for (E14-S06, and E14-S07 for the removal of an entry). An exemption added can
// turn a red check green and one taken away a green check red, so every repository the entry covers that enforces the CLA gets one
// `sweep-repository` job, sent on the connection of the transaction that changed the list: the change and its jobs commit or roll
// back together. The sweep itself (listing the open pull requests and evaluating them) is E07-S09's, and so is the way a job is
// sent (`enqueueSweepRepository`, coalesced per repository while a run waits, so rapid edits collapse into one run that reads the
// list when it starts); the key below names the send.

/** A repository of the tenant by the ids a job names: GitHub's, never the surrogate keys of our tables. */
interface SweptRepository {
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
}

/**
 * The repositories of the tenant that enforce the CLA and that an entry covers: the one `repositoryId` names, or when that is null
 * every one of the installation. A repository that is disabled enforces nothing and one GitHub no longer lists is not evaluated. In the
 * order of their row ids. The installation is in the WHERE clause of the statement, so a repository id of another tenant finds nothing.
 */
async function enforcingRepositories(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number | null,
): Promise<SweptRepository[]> {
  let query = db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select(['i.github_installation_id', 'r.github_repo_id'])
    .where('r.installation_id', '=', scope.installationId)
    .where('r.enabled', '=', true)
    .where('r.removed_at', 'is', null);
  if (repositoryId !== null) {
    query = query.where('r.id', '=', repositoryId);
  }
  const rows = await query.orderBy('r.id').execute();
  return rows.map((row) => ({
    githubInstallationId: parseGithubId(row.github_installation_id),
    githubRepoId: parseGithubId(row.github_repo_id),
  }));
}

/** The change a sweep follows: the repository the entry is for (null: the whole installation) and what names the change. */
interface AllowlistChange {
  /** `repositories.id`, or null for an entry that covers the installation. */
  readonly repositoryId: number | null;
  /** Names the change in the key of each send: `created:<entry id>`, so a retry sends the same and a later change another. */
  readonly change: string;
}

/**
 * Sends a `sweep-repository` job with the reason `allowlist_changed` for each enforcing repository the entry covers. The send is
 * keyed by the change and the repository, so a retry of the same request sends nothing twice. No time window is used: a second
 * change a few seconds after the first must still be swept, because a run that has started has read the list before it (a run that
 * still waits for a worker reads the newer list when it starts, which is why E07-S09 coalesces the two).
 * @throws Error whatever the enqueuer rejects with; the caller's transaction is rolled back, and so is the change.
 */
export async function sendAllowlistSweeps(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  change: AllowlistChange,
): Promise<void> {
  for (const repository of await enforcingRepositories(trx, scope, change.repositoryId)) {
    await enqueueSweepRepository(trx, enqueuer, {
      ...repository,
      reason: 'allowlist_changed',
      idempotencyKey: `sweep-repository:allowlist_changed:${change.change}:${String(repository.githubRepoId)}`,
    });
  }
}
