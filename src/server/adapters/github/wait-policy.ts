// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { GitHubRateLimitedError } from '../../services/ports/github-errors.ts';

// Which of GitHub's limits are slept through and which are handed to the caller (E05-S05).

/** The longest limit that is slept through, in seconds. A longer one is raised at once. */
export const MAX_WAIT_SECONDS = 60;

/** How many times one request waits out a limit and is repeated. The third limit in a row is raised. */
const MAX_REPEATS = 2;

/** True when `error` is a limit the request waits out and repeats after: 60 s or less, and not one repeat too many. */
export function isWorthWaiting(error: unknown, repeats: number): error is GitHubRateLimitedError {
  return (
    error instanceof GitHubRateLimitedError && error.retryAfterSeconds <= MAX_WAIT_SECONDS && repeats < MAX_REPEATS
  );
}
