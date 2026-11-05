// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';

// The repository-level jobs (E07-S09): what a change of policy asks of the queue. A change of the CLA, the allowlist, the
// overrides or the enforcement of a repository can turn the result of every open pull request of that repository, so the
// callers (E12, E14, E15) do not evaluate anything themselves: they send one `sweep-repository` job, which evaluates the open
// pull requests again, or (turning enforcement off) one `finalise-repository` job, which completes the checks that are
// still pending. This module owns the closed set of reasons and the coalesce rule, so no later epic invents either.

/**
 * Why a `sweep-repository` job exists, a closed set. The callers are E14-S03 (`repository_enabled`), E14-S02
 * (`cla_document_changed`), E12-S04 (`cla_version_published`), E14-S06 (`allowlist_changed`) and E15-S03 to S06
 * (`signature_revoked`, `signatures_invalidated`, `override_changed`), and E21-S04 (`corporate_claim`, an employee who claimed coverage
 * under an employer's agreement). The reason is for the log and the audit trail of the caller: the run reads the policy at the time it runs, so it does the same whatever the reason.
 */
export const SWEEP_REPOSITORY_REASONS = [
  'repository_enabled',
  'cla_version_published',
  'cla_document_changed',
  'allowlist_changed',
  'signature_revoked',
  'signatures_invalidated',
  'override_changed',
  'corporate_claim',
] as const;

export type SweepRepositoryReason = (typeof SWEEP_REPOSITORY_REASONS)[number];

/**
 * The coalesce key of a `sweep-repository` job: one per repository, whatever the reason. The send is dropped while a job of the
 * repository is waiting, because that run reads the policy when it starts and so covers the change; a run that already started
 * may have read the policy before the change, so it does not stop the send.
 */
export function sweepRepositoryCoalesceKey(githubRepoId: GithubId): string {
  return `sweep-repository:${String(githubRepoId)}`;
}
