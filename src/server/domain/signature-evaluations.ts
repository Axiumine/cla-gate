// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { parseStoredDetails } from '../../shared/pr-evaluation-details.ts';

// Which pull requests are evaluated again when a person signs (E13-S07), pure: the pull request the person came from, and the
// other pull requests of the same tenant whose stored failure names them as uncovered. The statements are in
// services/failing-evaluation-queries.ts and the sends in services/sign-evaluations.ts; this file owns the numbers, the
// idempotency key and the one question asked of a stored failure.

/**
 * The most of the signer's other failing pull requests that one signing asks to be evaluated again. A person with more than this
 * many failing pull requests in one tenant is rare, and the ones beyond the cap are not lost: the reconciliation sweep (E07-S08)
 * finds every pull request with no final result for its head SHA, and the next push or `/recheck` evaluates the rest.
 */
export const MAX_FAILING_PULL_REQUESTS = 25;

/**
 * The most stored failures the lookup reads to find {@link MAX_FAILING_PULL_REQUESTS} that parse: four times the cap. The
 * statement already keeps the rows whose details name the signer, so a row the schema refuses (a value of an older shape) is the
 * exception, and the spare rows are what lets the cap fill up when one is met.
 */
export const FAILING_LOOKUP_ROWS = MAX_FAILING_PULL_REQUESTS * 4;

/**
 * The idempotency key of the evaluation a signature asks for on one pull request: the signature, the repository and the pull
 * request. A retry of the request that records the signature finds nothing to send twice, and a later signature (after a
 * revocation, or of a later major) sends again. No coalesce or dedupe key is used: an `evaluate-pr` job is serialised per pull
 * request by the queue, so the send is never dropped for another job that waits, and the job reads the signatures last.
 */
export function signatureEvaluationKey(signatureId: number, githubRepoId: GithubId, prNumber: number): string {
  return `signature:${String(signatureId)}:${String(githubRepoId)}:${String(prNumber)}`;
}

/**
 * The JSON that a stored failure holds when it lists `githubId` among its uncovered actors: the document the statement's
 * containment test (`details @> needle`) looks for. It narrows the rows the lookup reads; {@link listsUncovered} is what decides.
 */
export function uncoveredActorNeedle(githubId: GithubId): string {
  return JSON.stringify({ actors: [{ githubId, covered: false }] });
}

/**
 * Whether the stored details of an evaluation record a failure that lists `githubId` among the uncovered identities. The value
 * is read through the schema of E08 (`parseStoredDetails`), which never throws: a value of another shape (an old version, a row
 * still in progress with `{}`, junk) lists nobody. An identity is the numeric GitHub id, never a login.
 */
export function listsUncovered(details: unknown, githubId: GithubId): boolean {
  const parsed = parseStoredDetails(details);
  return (
    parsed.ok &&
    parsed.details.outcome === 'failure' &&
    parsed.details.actors.some((actor) => actor.githubId === githubId && !actor.covered)
  );
}
