// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The rules of the reconciliation sweep (E07-S08), pure: how often it runs, how much of a repository it reads, and which pull
// requests it asks to be evaluated again. A webhook delivery that never arrived (GitHub's outage, ours, a lost job) leaves a
// pull request with no result for its head SHA; the sweep finds those and nothing else, so it spends the API budget on the
// pull requests that need it and leaves the ones with a final result alone.
import type { GithubId } from '../../shared/github-id.ts';

/**
 * The minutes between two sweeps `SWEEP_INTERVAL_MINUTES` may name, 0 meaning no sweep. Only the divisors of an hour (and the
 * hour itself) are allowed, because the interval becomes a cron expression whose minute field repeats inside the hour: 45
 * would run at :00, :45, :00, which is not every 45 minutes.
 */
export const SWEEP_INTERVALS = [0, 5, 10, 15, 20, 30, 60] as const;

export type SweepInterval = (typeof SWEEP_INTERVALS)[number];

/** The most open pull requests the sweep reads of one repository in one run (ten pages of 100). */
export const MAX_SWEPT_PULLS = 1000;

/** Pull requests per page of GitHub's listing, the most it gives. */
export const SWEEP_PAGE_SIZE = 100;

/**
 * The most pull requests of one repository whose `pr_state` one sweep asks GitHub about, in each direction (closing and reopening
 * the rows the listing contradicts, E15-S01): a repository with a long history is corrected over several sweeps, and a run never
 * spends more than this many requests on it.
 */
export const MAX_STATE_CONFIRMATIONS = 50;

/** Seconds an evaluation may stay `in_progress` before the sweep takes it for lost: 30 minutes, well past the last retry of a job. */
export const STALE_AFTER_SECONDS = 30 * 60;

/**
 * The coalesce key of the evaluation a sweep (or a change of policy) asks for, one per pull request: the send is dropped while an
 * evaluation of that pull request is waiting, because it will read the pull request and the policy when it runs.
 */
export function evaluationCoalesceKey(githubRepoId: GithubId, prNumber: number): string {
  return `evaluation:${String(githubRepoId)}:${String(prNumber)}`;
}

/** The coalesce key of the `sweep-installation` job of one installation: a sweep that meets one still waiting sends none twice. */
export function sweepInstallationCoalesceKey(githubInstallationId: GithubId): string {
  return `sweep-installation:${String(githubInstallationId)}`;
}

/** The key of the evaluation of one pull request at one head SHA: what the stored states of a repository are looked up by. */
export const evaluationKey = (prNumber: number, headSha: string): string => `${String(prNumber)}@${headSha}`;

/** What the sweep knows of the evaluation stored for a pull request at its current head SHA. */
export interface StoredEvaluationState {
  readonly result: 'in_progress' | 'success' | 'failure' | 'cancelled';
  /** When the row last changed, in milliseconds since the epoch: an `in_progress` row is as old as the last time its job touched it. */
  readonly updatedAtMs: number;
}

/**
 * Whether an `in_progress` evaluation last touched at `updatedAtMs` is older than {@link STALE_AFTER_SECONDS} at `nowMs`.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export function isStale(updatedAtMs: number, nowMs: number): boolean {
  return nowMs - updatedAtMs > STALE_AFTER_SECONDS * 1000;
}

/**
 * Whether the sweep asks for a new evaluation of a pull request whose current head SHA has `stored` as its row, or none.
 * - No row: nobody evaluated this head SHA, so a delivery was missed.
 * - `success` or `failure`: a final result for this head SHA; the sweep never repeats it.
 * - `cancelled`: the pull request was closed and reopened, or the evaluation was dropped; it has no verdict.
 * - `in_progress`: only when it is stale, because a younger one is a job that is still running or waiting for its retry.
 */
export function needsSweepEvaluation(stored: StoredEvaluationState | undefined, nowMs: number): boolean {
  if (stored === undefined || stored.result === 'cancelled') {
    return true;
  }
  return stored.result === 'in_progress' && isStale(stored.updatedAtMs, nowMs);
}
