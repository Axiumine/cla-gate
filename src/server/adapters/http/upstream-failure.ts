// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { GitHubRateLimitedError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { PublicVerificationUnavailableError } from '../../services/public-verification.ts';
import { RoleLookupThrottledError } from '../../services/role-lookup-budget.ts';

// What a client is told when the answer to "what may this person do here" could not be had (E11-S04). GitHub is the source
// of every role, so when it fails the request fails: the guard never turns a failure into an empty list, a `none` role or
// an implicit allow, and a caller cannot mistake an outage for "you may not". The error handler of errors.ts builds the
// `AppError` from this description and sets the `retry-after` header.

/** The longest wait a client is told to sit out, whatever GitHub asked for: a longer one is a reason to come back later, not to hold a page. */
const MAX_RETRY_AFTER_SECONDS = 300;

export interface UpstreamFailure {
  readonly status: 429 | 502 | 503;
  /** The stable code of the error body. */
  readonly code: 'too_many_requests' | 'github_unavailable' | 'github_rate_limited' | 'upstream_unavailable';
  /** Whole seconds for the `retry-after` header, when the failure has a wait. */
  readonly retryAfterSeconds?: number;
}

/**
 * How `error` is told to the client, or `undefined` when it is not one of these failures (it is then handled as any other
 * error). `GitHubUnavailableError` (an outage, or no answer within the 5 s deadline) is `502 github_unavailable`;
 * `GitHubRateLimitedError` is `503 github_rate_limited` with GitHub's wait, at most 300 s; `RoleLookupThrottledError` (the
 * person's 30 uncached lookups a minute are used up) is `429 too_many_requests` with the wait until one is free again.
 * `PublicVerificationUnavailableError` (the public signature check could not have GitHub say who a login is, E22-S02) is
 * `503 upstream_unavailable` with the wait it carries.
 */
export function upstreamFailure(error: unknown): UpstreamFailure | undefined {
  if (error instanceof PublicVerificationUnavailableError) {
    return { status: 503, code: 'upstream_unavailable', retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof GitHubUnavailableError) {
    return { status: 502, code: 'github_unavailable' };
  }
  if (error instanceof GitHubRateLimitedError) {
    return {
      status: 503,
      code: 'github_rate_limited',
      retryAfterSeconds: Math.min(error.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS),
    };
  }
  if (error instanceof RoleLookupThrottledError) {
    return { status: 429, code: 'too_many_requests', retryAfterSeconds: error.retryAfterSeconds };
  }
  return undefined;
}
