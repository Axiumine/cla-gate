// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type InstallationState, installationEligibility } from './eligibility.ts';
import type { Job } from './jobs.ts';
import type { REDIRECT_REASONS, Routing, TENANT_IGNORE_REASONS } from './webhook-routing-types.ts';

// The tenant and admission filter of the webhook intake (E06-S05): whether the installation a routed delivery names is
// one the instance serves. Pure, like the routing table: the caller reads the two facts from the database (no GitHub
// call) and this module decides. Identity is the numeric GitHub id: a delivery is judged by the ids its job carries.

/** One reason of {@link TENANT_IGNORE_REASONS}: the delivery is turned away and starts nothing. */
type TenantIgnoreReason = (typeof TENANT_IGNORE_REASONS)[number];

/** One reason of {@link REDIRECT_REASONS}. */
type RedirectReason = (typeof REDIRECT_REASONS)[number];

/** The job that re-reads one installation (E05-S08). */
type SyncInstallationJob = Extract<Job, { readonly type: 'sync-installation' }>;

/**
 * The jobs that are about a tenant's repository, the ones the filter applies to: the pull request, check and comment
 * events. `sync-installation` and `revoke-user-sessions` are how installations and revocations are learned, so they bypass it.
 */
export type TenantJob = Exclude<Job, { readonly type: 'sync-installation' | 'revoke-user-sessions' }>;

const BYPASSING_JOBS: ReadonlySet<Job['type']> = new Set(['sync-installation', 'revoke-user-sessions']);

/** Whether the filter applies to `job`. `installation`, `installation_repositories` and `github_app_authorization` do not pass through it. */
export function isTenantJob(job: Job): job is TenantJob {
  return !BYPASSING_JOBS.has(job.type);
}

/**
 * A delivery dropped and replaced by a `sync-installation` job for the installation it names: the PR event itself is
 * ignored (`reason` says why, and is what the answer to GitHub carries), and the sync is how the stored state catches up.
 * The sync is the one job this delivery starts, so recording and enqueueing it (E06-S06) is the same as for any job.
 */
interface Redirected {
  readonly kind: 'redirected';
  readonly reason: RedirectReason;
  readonly job: SyncInstallationJob;
}

/** What a delivery that passed the filter becomes: the routing table's answer, or the sync that replaced it. */
export type AdmittedRouting = Routing | Redirected;

/** The filter's verdict on one fact: go on, turn the delivery away, or replace it by a sync. */
export type TenantVerdict =
  | { readonly kind: 'served' }
  | { readonly kind: 'ignored'; readonly reason: TenantIgnoreReason }
  | Redirected;

const SERVED: TenantVerdict = { kind: 'served' };

/** The reason an installation the instance does not serve is turned away with, by the reason the eligibility rule gives. */
const IGNORE_BY_ELIGIBILITY = {
  installation_rejected: 'installation_not_admitted',
  installation_deleted: 'installation_deleted',
  installation_suspended: 'installation_suspended',
} as const satisfies Readonly<Record<string, TenantIgnoreReason>>;

/** Replaces the delivery of `job` by the sync of the installation it names, carrying the same delivery id. */
function redirect(job: TenantJob, reason: RedirectReason): Redirected {
  return {
    kind: 'redirected',
    reason,
    job: { type: 'sync-installation', githubInstallationId: job.githubInstallationId, deliveryId: job.deliveryId },
  };
}

/**
 * The first fact: the stored row of the installation the payload names (`null`: none is stored). No row means a missed
 * `installation.created`, which the sync heals, so the delivery becomes a sync. A row is served only when the policy
 * admitted it and it is neither uninstalled nor suspended, checked in the same order as the installation gate (E05-S03),
 * so the instance stops an installation for the same reason everywhere. The row says what the last sync decided; nothing
 * here asks GitHub, or the policy, which could.
 */
export function judgeInstallation(job: TenantJob, installation: InstallationState | null): TenantVerdict {
  if (installation === null) {
    return redirect(job, 'installation_unknown');
  }
  const served = installationEligibility(installation);
  return served.eligible ? SERVED : { kind: 'ignored', reason: IGNORE_BY_ELIGIBILITY[served.reason] };
}

/** The second fact about a delivery's tenant. */
export interface RepositoryFacts {
  /** Whether the repository the payload names is stored, active, under an installation other than the payload's. */
  readonly heldByAnotherInstallation: boolean;
}

/**
 * The second fact, read only for an installation that is served: whether the repository the payload names is stored,
 * active, under another installation (a transfer whose state has not caught up). The delivery is then dropped and the
 * payload's installation is synced. A repository that is not stored at all is served: the job re-checks eligibility when
 * it runs (E05-S06), and an event that arrives before the repository row exists is not lost.
 */
export function judgeRepository(job: TenantJob, facts: RepositoryFacts): TenantVerdict {
  return facts.heldByAnotherInstallation ? redirect(job, 'repository_installation_mismatch') : SERVED;
}
