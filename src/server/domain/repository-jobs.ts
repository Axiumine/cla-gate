// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';

// The repository-level jobs (E07-S09): what a change of policy asks of the queue. A change of the CLA, the allowlist, the
// overrides or the enforcement of a repository can turn the result of every open pull request of that repository, so the
// callers (E12, E14, E15) do not evaluate anything themselves: they send one `sweep-repository` job, which evaluates the open
// pull requests again, or (turning enforcement off) one `finalise-repository` job, which completes the checks that are
// still pending. This module owns the closed set of reasons and the dedupe rules, so no later epic invents either.

/**
 * Why a `sweep-repository` job exists, a closed set. The callers are E14-S02 (`repository_enabled`), E14-S03
 * (`cla_document_changed`), E12-S04 (`cla_version_published`), E14-S06 (`allowlist_changed`) and E15-S03 to S06
 * (`signature_revoked`, `signatures_invalidated`, `override_changed`). The reason is for the log and the audit trail of the
 * caller: the run reads the policy at the time it runs, so it does the same whatever the reason.
 */
export const SWEEP_REPOSITORY_REASONS = [
  'repository_enabled',
  'cla_version_published',
  'cla_document_changed',
  'allowlist_changed',
  'signature_revoked',
  'signatures_invalidated',
  'override_changed',
] as const;

export type SweepRepositoryReason = (typeof SWEEP_REPOSITORY_REASONS)[number];

/** Seconds in which a repository takes one `sweep-repository` job: rapid edits of the policy collapse into one run. */
export const SWEEP_REPOSITORY_WINDOW_SECONDS = 60;

/**
 * Seconds in which a pull request takes one `evaluate-pr` job with the trigger `policy_change`. pg-boss has one key per job, so
 * on the serialised queue of `evaluate-pr` the window is the one of the pull request, shared with the other triggers that
 * send under a window (E07-S01, E07-S07, E07-S08).
 */
export const POLICY_CHANGE_WINDOW_SECONDS = 60;

/** The dedupe key of a `sweep-repository` job: one per repository, whatever the reason. */
export function sweepRepositoryDedupeKey(githubRepoId: GithubId): string {
  return `sweep-repository:${String(githubRepoId)}`;
}

/** The dedupe key of the `evaluate-pr` job a `sweep-repository` run sends for one pull request. */
export function policyChangeDedupeKey(githubRepoId: GithubId, prNumber: number): string {
  return `policy_change:${String(githubRepoId)}:${String(prNumber)}`;
}
