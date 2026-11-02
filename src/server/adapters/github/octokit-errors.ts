// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { RequestError } from 'octokit';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { unreachable } from './github-http.ts';

// What Octokit throws, turned into what the port promises (E05-S04, E05-S05). The messages are fixed text plus the route
// template: GitHub's own message, the URL, the headers and the body never reach an error (Octokit's message quotes the
// body, and its `request` holds the Authorization header).

/** GitHub's wording for both limits: "API rate limit exceeded", "You have exceeded a secondary rate limit". */
const RATE_LIMIT_TEXT = /\brate limit\b/i;

/** A header that is a whole number of seconds: digits only, so a sign, a fraction or a 12-digit value is no wait. */
const WHOLE_SECONDS = /^\d{1,10}$/;

/** GitHub: with no `retry-after` and no reset time, wait at least one minute. */
const FALLBACK_WAIT_SECONDS = 60;

/** The three headers that say how long to wait, as text; undefined for one that is missing. */
interface LimitHeaders {
  readonly retryAfter: string | undefined;
  readonly remaining: string | undefined;
  readonly reset: string | undefined;
}

function limitHeaders(error: RequestError): LimitHeaders {
  const headers = error.response?.headers;
  const text = (value: string | number | undefined): string | undefined =>
    value === undefined ? undefined : String(value);
  return {
    retryAfter: text(headers?.['retry-after']),
    remaining: text(headers?.['x-ratelimit-remaining']),
    reset: text(headers?.['x-ratelimit-reset']),
  };
}

/** The number of seconds a header holds, or undefined when it is missing or is not a whole number. */
function secondsOf(value: string | undefined): number | undefined {
  return value !== undefined && WHOLE_SECONDS.test(value) ? Number(value) : undefined;
}

/** True for a 429, and for a 403 that carries `retry-after`, says the budget is used up or words itself as a rate limit. */
function isRateLimit(error: RequestError, headers: LimitHeaders): boolean {
  return (
    error.status === 429 ||
    (error.status === 403 &&
      (headers.retryAfter !== undefined || headers.remaining === '0' || RATE_LIMIT_TEXT.test(error.message)))
  );
}

/**
 * The limit a failed request ran into, or undefined when it is not one ({@link isRateLimit}); otherwise a 403 is a
 * refusal. The wait is `retry-after`, else the time to `x-ratelimit-reset` (epoch seconds) for the primary limit, else
 * 60 s; never less than 1 s, and a header that is not a whole number counts as missing. The scope is `primary` when the
 * budget is used up and `secondary` for everything else.
 */
function rateLimitOf(error: RequestError, nowMs: number): GitHubRateLimitedError | undefined {
  const headers = limitHeaders(error);
  if (!isRateLimit(error, headers)) {
    return undefined;
  }
  const exhausted = headers.remaining === '0';
  const reset = secondsOf(headers.reset);
  const untilReset = exhausted && reset !== undefined ? Math.ceil(reset - nowMs / 1000) : undefined;
  const wait = secondsOf(headers.retryAfter) ?? untilReset ?? FALLBACK_WAIT_SECONDS;
  return new GitHubRateLimitedError(Math.max(1, wait), exhausted ? 'primary' : 'secondary');
}

/**
 * The error to throw for a failed Octokit request to `route` (a template such as `GET /repositories/{repository_id}`)
 * made at `nowMs`: no answer is an outage, 401 {@link GitHubAuthError}, 404 {@link GitHubNotFoundError}, a 429 or a
 * 403 that is a rate limit {@link GitHubRateLimitedError} (the limiter waits it out when it can; see `rate-limiter.ts`),
 * another 403 {@link GitHubForbiddenError}, and every other status (a 5xx) {@link GitHubUnavailableError}. A rate limit
 * is not "forbidden" because a caller that reads 403 as "no access" (a repository that left the installation) would
 * take a limit for a removal.
 */
export function failureOf(error: unknown, route: string, nowMs: number): Error {
  if (!(error instanceof RequestError) || error.response === undefined) {
    return unreachable(error instanceof RequestError ? error.cause : error);
  }
  const { status } = error;
  if (status === 401) {
    return new GitHubAuthError();
  }
  if (status === 404) {
    return new GitHubNotFoundError(route);
  }
  const limit = rateLimitOf(error, nowMs);
  if (limit !== undefined) {
    return limit;
  }
  return status === 403
    ? new GitHubForbiddenError(route)
    : new GitHubUnavailableError(`GitHub answered ${status} to ${route}`);
}
