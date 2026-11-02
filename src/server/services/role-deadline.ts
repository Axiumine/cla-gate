// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { GitHubUnavailableError } from './ports/github-errors.ts';

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
 * {@link ROLE_LOOKUP_TIMEOUT_MS}. The timer is cleared as soon as `work` settles; an answer that arrives after the deadline
 * is dropped (the request itself cannot be called back, but nothing waits for it and its failure is handled by the race).
 */
export async function withRoleDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new GitHubUnavailableError(`GitHub did not answer a role lookup within ${ROLE_LOOKUP_TIMEOUT_MS} ms`));
    }, ROLE_LOOKUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
