// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { RateLimitScope } from '../../services/ports/github-errors.ts';
import type { LaneScope } from './lane.ts';

// The log line of a wait on a limit (E05-S05), the one an operator watches.

/** The request a turn of the rate limiter is for: the lane it counts in and its route template. */
export interface LimitedRequest {
  readonly scope: LaneScope;
  readonly route: string;
}

/**
 * One WARN, `github.rate_limited`, for a sleep that waits out a limit: the limit's scope, how long, the route template and
 * the numeric installation id (null for the App's own lane). Nothing from the answer of GitHub is in it.
 */
export function warnRateLimited(
  logger: Logger,
  request: LimitedRequest,
  limit: RateLimitScope,
  waitSeconds: number,
): void {
  logger.warn(
    {
      scope: limit,
      waitSeconds,
      route: request.route,
      installationId: request.scope === 'app' ? null : request.scope,
    },
    'github.rate_limited',
  );
}
