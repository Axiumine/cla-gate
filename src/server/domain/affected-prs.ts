// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { SweepRepositoryReason } from './repository-jobs.ts';

// Which pull requests an action of a maintainer asks to have evaluated again (E15-S03, and E15-S05 and E15-S06 after it), pure: the
// numbers, the idempotency keys and the question asked of a stored result. The statements are in services/affected-prs-queries.ts
// and the sends in services/affected-prs.ts. An action that changes what covers a contributor (a revoked signature, an override
// added or taken away) re-evaluates the open pull requests it can change, one `evaluate-pr` job each, and above this many it sends
// one `sweep-repository` job for each repository instead, which lists the open pull requests itself (E07-S09).

/** The most pull requests one action evaluates one by one; one more and the repositories are swept instead. */
export const MAX_AFFECTED_PULL_REQUESTS = 100;

/**
 * The idempotency key of the evaluation an action asks for on one pull request: the reason of the action, what names this one action
 * (the id of the signature that was revoked), the repository and the pull request. A retry of the request that records the action
 * finds nothing to send twice, and a later action sends again. No coalesce or dedupe key goes with it: an `evaluate-pr` job is
 * serialised per pull request by the queue, so the send is never dropped for another job that waits, and the job reads the policy
 * when it runs.
 */
export function affectedEvaluationKey(
  action: { readonly reason: SweepRepositoryReason; readonly change: string },
  githubRepoId: GithubId,
  prNumber: number,
): string {
  return `${action.reason}:${action.change}:${String(githubRepoId)}:${String(prNumber)}`;
}

/** The idempotency key of the sweep of one repository an action asks for, in the form of the allowlist's (E14-S06). */
export function affectedSweepKey(
  action: { readonly reason: SweepRepositoryReason; readonly change: string },
  githubRepoId: GithubId,
): string {
  return `sweep-repository:${action.reason}:${action.change}:${String(githubRepoId)}`;
}

/**
 * The JSON documents that a stored result holds when the person `githubId` is covered by a signature (E08-S01): an actor with that
 * numeric id and a covering basis of the kind `signature`, and an actor whose basis names the signature `signatureId`. The statement
 * keeps the rows whose details contain either (`details @> needle`); the first already includes the second for every signature of the
 * person, and the second is the exact fact a revocation takes away. An identity is the numeric GitHub id, never a login.
 */
export function signatureBasisNeedles(signatureId: number, githubId: GithubId): readonly [string, string] {
  return [
    JSON.stringify({ actors: [{ githubId, covered: true, basis: { kind: 'signature' } }] }),
    JSON.stringify({ actors: [{ covered: true, basis: { kind: 'signature', signatureId } }] }),
  ];
}
