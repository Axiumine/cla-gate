// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { withGitHubDeadline } from './github-deadline.ts';

// How long a request waits for GitHub to say what a person may do (E11-S02). The GitHub client port waits up to its own
// timeout for each attempt and repeats an idempotent read twice, which is right for a job and far too long for a person
// who is waiting for a page; the role lookups of the request path give up after this deadline and fail closed.

/**
 * The most a role lookup waits for GitHub in total, repeats included.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const ROLE_LOOKUP_TIMEOUT_MS = 5000;

/**
 * `work` as it settles, or a rejection with `GitHubUnavailableError` when it has not settled after
 * {@link ROLE_LOOKUP_TIMEOUT_MS} (see {@link withGitHubDeadline}).
 */
export function withRoleDeadline<T>(work: Promise<T>): Promise<T> {
  return withGitHubDeadline(() => work, { ms: ROLE_LOOKUP_TIMEOUT_MS, what: 'a role lookup' });
}
