// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { GitHubUnavailableError } from './ports/github-errors.ts';

// How long a request that a person waits for gives GitHub (E11-S02, E15-S05). The GitHub client port waits up to its own timeout for
// each attempt and repeats an idempotent read twice, which is right for a job and far too long for a person who is waiting for a page;
// a call made on the request path gives up after its deadline and fails as an outage.

/**
 * The call `work` starts, as it settles, or a rejection with `GitHubUnavailableError` when it has not settled after `limit.ms`
 * milliseconds; `limit.what` names the call in the message (fixed text: nothing of the request). The timer is cleared as soon as the
 * call settles; an answer that arrives after the deadline is dropped (the request itself cannot be called back, but nothing waits for
 * it and its failure is handled by the race).
 * @param work starts the call to GitHub.
 * @param limit how long it may take and what it is, for the message.
 * @param limit.ms the deadline in milliseconds.
 * @param limit.what the call as a phrase, such as `a role lookup`.
 */
export async function withGitHubDeadline<T>(
  work: () => Promise<T>,
  limit: { readonly ms: number; readonly what: string },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new GitHubUnavailableError(`GitHub did not answer ${limit.what} within ${limit.ms} ms`));
    }, limit.ms);
  });
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
