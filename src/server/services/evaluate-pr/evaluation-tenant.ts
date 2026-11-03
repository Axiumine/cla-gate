// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { evaluationEligibility } from '../../domain/eligibility.ts';
import { findInstallationByGithubId } from '../installation-queries.ts';
import type { GitHubClient } from '../ports/github.ts';
import { findRepositoryByGithubId } from '../repository-queries.ts';
import { refreshRepositorySnapshot, type SnapshotContext } from '../repository-refresh.ts';
import type { Tenant } from './evaluation-facts.ts';

// What the job settles before it asks GitHub about the pull request (E07-S04): which stored installation and repository it
// is for, whether they are evaluated at all, and the name GitHub gives the repository now.

/** The two ids of a job that evaluates something of a repository: `evaluate-pr`, and (E07-S05) `evaluate-head-sha`. */
interface Job {
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
}

/** What step 1 settles: the repository as GitHub names it now, with the stored tenant. */
export interface Resolved {
  readonly tenant: Tenant;
  readonly fullName: string;
}

/**
 * The stored installation and repository the job names, or the reason to skip it: no row for the installation or the
 * repository under it (a repository of another installation is not found, never read), or a state that is not evaluated.
 * No GitHub call is made for any of them.
 */
export async function loadTenant(db: Kysely<Database>, job: Job): Promise<Tenant | string> {
  const installation = await findInstallationByGithubId(db, job.githubInstallationId);
  if (installation === null) {
    return 'installation_not_found';
  }
  const repository = await findRepositoryByGithubId(db, installation.id, job.githubRepoId);
  if (repository === null) {
    return 'repository_not_found';
  }
  const eligibility = evaluationEligibility(
    {
      admissionStatus: installation.admission_status,
      deletedAt: installation.deleted_at,
      suspendedAt: installation.suspended_at,
    },
    { removedAt: repository.removed_at, enabled: repository.enabled },
  );
  return eligibility.eligible ? { installation, repository } : eligibility.reason;
}

/**
 * Step 1: asks GitHub for the repository. A different name than the stored one (a rename, a transfer) is stored through the
 * snapshot refresh; a repository GitHub no longer shows the installation ends the job (the refresh marks it removed).
 */
export async function resolveRepository(ctx: SnapshotContext, job: Job, tenant: Tenant): Promise<Resolved | null> {
  const remote = await ctx.github.getRepositoryById(job.githubInstallationId, job.githubRepoId);
  if (remote?.fullName !== tenant.repository.full_name) {
    await refreshRepositorySnapshot(ctx, job.githubInstallationId, job.githubRepoId);
  }
  return remote === null ? null : { tenant, fullName: remote.fullName };
}

/** A job about one pull request of a repository. */
interface PullRequestJob extends Job {
  readonly prNumber: number;
}

/** What `loadPullRequest` settles: the repository as GitHub names it now and the pull request as GitHub shows it now. */
export interface LoadedPullRequest {
  readonly resolved: Resolved;
  /** `null` when GitHub no longer shows the pull request. */
  readonly pr: Awaited<ReturnType<GitHubClient['getPullRequest']>>;
}

/**
 * Everything a job about one pull request settles before the state of the pull request decides anything: the stored
 * tenant, the repository as GitHub names it now (step 1) and the pull request itself. A string is the reason to skip the
 * job, and no GitHub call is made for the reasons that come from the stored rows. `evaluate-pr` and `close-pr` both start
 * here and differ only in what they do with an open or a closed pull request.
 */
export async function loadPullRequest(
  ports: SnapshotContext,
  job: PullRequestJob,
): Promise<LoadedPullRequest | string> {
  const tenant = await loadTenant(ports.db, job);
  if (typeof tenant === 'string') {
    return tenant;
  }
  const resolved = await resolveRepository(ports, job, tenant);
  if (resolved === null) {
    return 'repository_gone';
  }
  const pr = await ports.github.getPullRequest(job.githubInstallationId, resolved.fullName, job.prNumber);
  return { resolved, pr };
}
