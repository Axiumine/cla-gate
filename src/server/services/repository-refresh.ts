// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import { lockInstallation } from '../adapters/db/advisory-lock.ts';
import type { Database } from '../adapters/db/schema.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { installationEligibility } from '../domain/eligibility.ts';
import { findInstallationByGithubId } from './installation-queries.ts';
import type { Clock } from './ports/clock.ts';
import type { GitHubClient } from './ports/github.ts';
import { appendRepositoryAudit } from './repository-audit.ts';
import {
  findActiveRepositoryByGithubId,
  markRepositoriesRemoved,
  renameActiveRepository,
} from './repository-queries.ts';

// The snapshot of one repository (E05-S09): its name changes when it is renamed or moves to another owner, and it leaves
// the installation when GitHub stops showing it. GitHub is the truth, so the function fetches the repository itself and
// the caller passes ids only.

/**
 * What a refresh did.
 * - `unchanged`: the stored repository already says what GitHub says.
 * - `renamed`: the stored `full_name` was replaced (a rename, or a new owner after a transfer).
 * - `removed`: GitHub answered 404 or 403, so the installation no longer reaches the repository; `removed_at` is set.
 * - `not_stored`: the installation has no active row for the id (never listed by a sync, or removed already); nothing is
 *   written, because a repository is added by the sync and not by a refresh.
 * - `not_served`: the installation is rejected, deleted, suspended or unknown by the time the lock is taken (another run
 *   closed it while GitHub was being asked); nothing is written into a tenant that has been closed.
 */
type SnapshotStatus = 'unchanged' | 'renamed' | 'removed' | 'not_stored' | 'not_served';

export interface SnapshotOutcome {
  readonly status: SnapshotStatus;
  /** A row was written: the repository and its audit entry. */
  readonly changed: boolean;
}

export interface SnapshotContext {
  readonly db: Kysely<Database>;
  readonly github: GitHubClient;
  readonly clock: Clock;
}

const outcome = (status: SnapshotStatus): SnapshotOutcome => ({
  status,
  changed: status === 'renamed' || status === 'removed',
});

/** GitHub no longer shows the repository to the installation: the row is marked removed and the removal is audited. */
async function removeLostRepository(
  ctx: SnapshotContext,
  trx: Transaction<Database>,
  installationId: number,
  githubRepoId: GithubId,
): Promise<SnapshotStatus> {
  const removed = await markRepositoriesRemoved(trx, installationId, [githubRepoId], ctx.clock.now());
  if (removed.length === 0) {
    return 'not_stored';
  }
  await appendRepositoryAudit(trx, {
    action: 'repository.removed',
    installationId,
    githubRepoId,
    reasonCode: 'access_lost',
  });
  return 'removed';
}

/** The stored name differs from GitHub's: it is replaced and `repository.renamed` is audited with the numeric ids only. */
async function renameChangedRepository(
  trx: Transaction<Database>,
  installationId: number,
  githubRepoId: GithubId,
  fullName: string,
): Promise<SnapshotStatus> {
  if (await renameActiveRepository(trx, installationId, githubRepoId, fullName)) {
    await appendRepositoryAudit(trx, { action: 'repository.renamed', installationId, githubRepoId });
    return 'renamed';
  }
  return (await findActiveRepositoryByGithubId(trx, installationId, githubRepoId)) === null
    ? 'not_stored'
    : 'unchanged';
}

/**
 * Brings the stored snapshot of one repository of an installation in line with GitHub: `getRepositoryById` (which the
 * stored gate of E05-S07 refuses for an installation the instance does not serve, before any request), then in one
 * transaction under the installation's advisory lock either the new `full_name` and `repository.renamed`, or, when GitHub
 * answers 404 or 403, `removed_at` and `repository.removed` (`reason_code` `access_lost`). The row stays in both cases:
 * its id, `enabled`, document, evaluations and signatures are untouched, and the Check Run name `license/cla` is a
 * constant that does not depend on the repository. A second call over unchanged state writes nothing.
 * @throws whatever the GitHub client throws (including `InstallationNotAdmittedError`) or the database throws.
 */
export async function refreshRepositorySnapshot(
  ctx: SnapshotContext,
  githubInstallationId: GithubId,
  githubRepoId: GithubId,
): Promise<SnapshotOutcome> {
  const remote = await ctx.github.getRepositoryById(githubInstallationId, githubRepoId);
  return withTransaction(ctx.db, async (trx) => {
    await lockInstallation(trx, githubInstallationId);
    const installation = await findInstallationByGithubId(trx, githubInstallationId);
    const served =
      installation !== null &&
      installationEligibility({
        admissionStatus: installation.admission_status,
        deletedAt: installation.deleted_at,
        suspendedAt: installation.suspended_at,
      }).eligible;
    if (!served) {
      return outcome('not_served');
    }
    return outcome(
      remote === null
        ? await removeLostRepository(ctx, trx, installation.id, githubRepoId)
        : await renameChangedRepository(trx, installation.id, githubRepoId, remote.fullName),
    );
  });
}
