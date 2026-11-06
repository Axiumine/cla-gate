// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ApiError } from '../api/errors.ts';
import { REQUEST_ID } from '../api/response.ts';

// What the error screens read out of an error (E17-S07): three facts, each safe to act on whatever the error is. None of
// them is the message of the error, which is never shown.

const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;
const SERVICE_UNAVAILABLE = 503;
/** The code of the 503 that waits: GitHub limits the installation and the server says for how long (E11-S04, E18-S04). */
const GITHUB_RATE_LIMITED = 'github_rate_limited';

/** The request id to show for `error`: the one the server sent, when it looks like one of the server's own, else none. */
export function visibleRequestId(error: unknown): string | undefined {
  const id = error instanceof ApiError ? error.requestId : undefined;
  return id !== undefined && REQUEST_ID.test(id) ? id : undefined;
}

/** Whether the server refused `error`'s request because of who is asking (403): the screen is the forbidden one. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === FORBIDDEN;
}

/**
 * The whole seconds a 429 asks to wait before the request is sent again, and a 503 `github_rate_limited` too (GitHub limits the
 * installation and `Retry-After` says for how long); 0 for any other error, or no `Retry-After`.
 */
export function waitSeconds(error: unknown): number {
  if (!(error instanceof ApiError)) {
    return 0;
  }
  const waits =
    error.status === TOO_MANY_REQUESTS || (error.status === SERVICE_UNAVAILABLE && error.code === GITHUB_RATE_LIMITED);
  return waits ? (error.retryAfterSeconds ?? 0) : 0;
}
