// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { createFailureThrottle } from './failure-throttle.ts';
import type { Clock } from './ports/clock.ts';

// What one person may cost the GitHub budgets of the tenants (E11-S04). Every installation has a rate limit of its own at
// GitHub, and a role lookup spends some of it; a signed-in person who walks over many installations' endpoints would
// spend all of them. So a person may have at most 30 uncached lookups a minute, whichever installations they are for, and
// is then told to come back (`429 too_many_requests` at the HTTP edge). A lookup the role cache answers costs nothing.

/** The limit: 30 uncached lookups per person in a sliding minute; the people remembered are bounded like every in-memory throttle. */
const ROLE_LOOKUP_LIMITS = { maxLookups: 30, windowMs: 60_000, maxViewers: 10_000 } as const;

/**
 * The person has used their uncached lookups of the minute. `retryAfterSeconds`, at least 1, is how long until the
 * oldest of them leaves the window. The message is fixed text: nothing of the person reaches it.
 */
export class RoleLookupThrottledError extends Error {
  override readonly name = 'RoleLookupThrottledError';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`too many uncached role lookups: retry after ${retryAfterSeconds} s`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ViewerLookupBudget {
  /**
   * Counts one uncached lookup of the person with this numeric GitHub id, right before it is made.
   * @throws RoleLookupThrottledError when that would be the 31st within the last minute; nothing is counted then.
   */
  spend(viewer: GithubId): void;
}

/** The budget of every person, in memory, per process: the key is the numeric id and nothing else is kept. */
export function createViewerLookupBudget(clock: Clock): ViewerLookupBudget {
  // A failure throttle holds a key back once it has recorded more than `maxFailures` events inside the window. Here the
  // events are lookups, and the 31st must be refused: it is refused when 30 are recorded, which is "more than 29".
  const throttle = createFailureThrottle({
    clock,
    maxFailures: ROLE_LOOKUP_LIMITS.maxLookups - 1,
    windowMs: ROLE_LOOKUP_LIMITS.windowMs,
    maxKeys: ROLE_LOOKUP_LIMITS.maxViewers,
  });
  return {
    spend(viewer) {
      const key = String(viewer);
      const wait = throttle.retryAfter(key);
      if (wait !== undefined) {
        throw new RoleLookupThrottledError(wait);
      }
      throttle.recordFailure(key);
    },
  };
}
