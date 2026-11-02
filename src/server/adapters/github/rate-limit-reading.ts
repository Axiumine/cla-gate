// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { GitHubRateLimitedError } from '../../services/ports/github-errors.ts';

// How GitHub's answer says "slow down" (E05-S05), shared by every way the platform talks to it: the Octokit adapter and
// the two calls made with plain `fetch` (`GET /app`, the token mint). Pure: it reads the status, three headers and the
// message of an answer, and returns the limit or nothing.

/** GitHub's wording for both limits: "API rate limit exceeded", "You have exceeded a secondary rate limit". */
const RATE_LIMIT_TEXT = /\brate limit\b/i;

/** A header that is a whole number of seconds: digits only, so a sign, a fraction or a 12-digit value is no wait. */
const WHOLE_SECONDS = /^\d{1,10}$/;

/** GitHub: with no `retry-after` and no reset time, wait at least one minute. */
const FALLBACK_WAIT_SECONDS = 60;

/** What an answer says about a limit: its status, the three headers that carry the wait, as text, and its message. */
export interface LimitSignals {
  readonly status: number;
  readonly retryAfter: string | undefined;
  readonly remaining: string | undefined;
  readonly reset: string | undefined;
  /** The message GitHub gave (it may quote the body); only searched for the words "rate limit", never kept. */
  readonly message: string;
}

/** The number of seconds a header holds, or undefined when it is missing or is not a whole number. */
function secondsOf(value: string | undefined): number | undefined {
  return value !== undefined && WHOLE_SECONDS.test(value) ? Number(value) : undefined;
}

/** True for a 429, and for a 403 that carries `retry-after`, says the budget is used up or words itself as a rate limit. */
function isRateLimit(signals: LimitSignals): boolean {
  return (
    signals.status === 429 ||
    (signals.status === 403 &&
      (signals.retryAfter !== undefined || signals.remaining === '0' || RATE_LIMIT_TEXT.test(signals.message)))
  );
}

/**
 * The limit an answer ran into, or undefined when it is not one ({@link isRateLimit}); a 403 that is not a limit is a
 * refusal. The wait is `retry-after`, else the time to `x-ratelimit-reset` (epoch seconds) for the primary limit, else
 * 60 s; never less than 1 s, and a header that is not a whole number counts as missing. The scope is `primary` when the
 * budget is used up and `secondary` for everything else.
 */
export function rateLimitFrom(signals: LimitSignals, nowMs: number): GitHubRateLimitedError | undefined {
  if (!isRateLimit(signals)) {
    return undefined;
  }
  const exhausted = signals.remaining === '0';
  const reset = secondsOf(signals.reset);
  const untilReset = exhausted && reset !== undefined ? Math.ceil(reset - nowMs / 1000) : undefined;
  const wait = secondsOf(signals.retryAfter) ?? untilReset ?? FALLBACK_WAIT_SECONDS;
  return new GitHubRateLimitedError(Math.max(1, wait), exhausted ? 'primary' : 'secondary');
}

/** The signals of an answer received with `fetch`: its headers, and the message its body gave (empty when it gave none). */
export function signalsOfResponse(response: Response, message: string): LimitSignals {
  const header = (name: string): string | undefined => response.headers.get(name) ?? undefined;
  return {
    status: response.status,
    retryAfter: header('retry-after'),
    remaining: header('x-ratelimit-remaining'),
    reset: header('x-ratelimit-reset'),
    message,
  };
}
