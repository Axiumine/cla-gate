// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { RequestError } from 'octokit';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { unreachable } from './github-http.ts';
import { type LimitSignals, rateLimitFrom } from './rate-limit-reading.ts';

// What Octokit throws, turned into what the port promises (E05-S04, E05-S05). The messages are fixed text plus the route
// template: GitHub's own message, the URL, the headers and the body never reach an error (Octokit's message quotes the
// body, and its `request` holds the Authorization header).

/** The signals of a failed Octokit request: `error.message` quotes the body, so it is only searched, never kept. */
function signalsOf(error: RequestError): LimitSignals {
  const headers = error.response?.headers;
  const text = (value: string | number | undefined): string | undefined =>
    value === undefined ? undefined : String(value);
  return {
    status: error.status,
    retryAfter: text(headers?.['retry-after']),
    remaining: text(headers?.['x-ratelimit-remaining']),
    reset: text(headers?.['x-ratelimit-reset']),
    message: error.message,
  };
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
  const limit = rateLimitFrom(signalsOf(error), nowMs);
  if (limit !== undefined) {
    return limit;
  }
  return status === 403
    ? new GitHubForbiddenError(route)
    : new GitHubUnavailableError(`GitHub answered ${status} to ${route}`);
}
