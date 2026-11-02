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

// What Octokit throws, turned into what the port promises (E05-S04). The messages are fixed text plus the route
// template: GitHub's own message, the URL, the headers and the body never reach an error (Octokit's message quotes the
// body, and its `request` holds the Authorization header).

/** GitHub's wording for both limits: "API rate limit exceeded", "You have exceeded a secondary rate limit". */
const RATE_LIMIT_TEXT = /\brate limit\b/i;

/** True when a 403 is a rate limit (primary or secondary) and not a refusal of what was asked. */
function isRateLimit(error: RequestError): boolean {
  const headers = error.response?.headers;
  return (
    String(headers?.['x-ratelimit-remaining']) === '0' ||
    headers?.['retry-after'] !== undefined ||
    RATE_LIMIT_TEXT.test(error.message)
  );
}

/**
 * The error to throw for a failed Octokit request to `route` (a template such as `GET /repositories/{repository_id}`):
 * no answer is an outage, 401 {@link GitHubAuthError}, 404 {@link GitHubNotFoundError}, 403 {@link GitHubForbiddenError}
 * unless it is a rate limit, and every other status (a 5xx, a 429, a rate-limit 403) {@link GitHubUnavailableError}.
 * A rate limit is not "forbidden" because a caller that reads 403 as "no access" (a repository that left the
 * installation) would take a limit for a removal.
 */
export function failureOf(error: unknown, route: string): Error {
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
  if (status === 403 && !isRateLimit(error)) {
    return new GitHubForbiddenError(route);
  }
  return new GitHubUnavailableError(`GitHub answered ${status} to ${route}`);
}
