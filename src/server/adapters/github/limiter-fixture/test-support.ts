// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import { GitHubRateLimitedError, type RateLimitScope } from '../../../services/ports/github-errors.ts';
import { FakeClock } from '../../../services/test-support.ts';
import { captureLogs, type LogCapture } from '../../../test-support.ts';
import { createLogger } from '../../http/logger.ts';
import { RateLimiter } from '../rate-limiter.ts';
import { START } from '../test-support.ts';

// What the tests of the rate limiter share (E05-S05): a limiter on a fake clock whose waits are recorded, not slept.

/** The installation ids the tests use as lanes. */
export const lane = (n: number): GithubId => parseGithubId(n);

export interface LimiterFixture {
  readonly limiter: RateLimiter;
  readonly clock: FakeClock;
  /** Every wait the limiter asked for, in milliseconds. */
  readonly waits: number[];
  readonly logs: LogCapture;
}

/**
 * A limiter on a fake clock. Each wait is recorded, then `hold` (if given) decides when it returns, and the clock moves
 * forward by the wait, so a limit that lasts 2 s is over when the wait returns.
 */
export function limiterFixture(hold?: (milliseconds: number) => Promise<void>): LimiterFixture {
  const clock = new FakeClock(START);
  const waits: number[] = [];
  const logs = captureLogs();
  const limiter = new RateLimiter({
    clock,
    logger: createLogger({ logLevel: 'info' }, logs.destination),
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      await hold?.(milliseconds);
      clock.advance(milliseconds);
    },
  });
  return { limiter, clock, waits, logs };
}

/** A GitHub limit as the adapter reports it. */
export const limited = (seconds: number, scope: RateLimitScope = 'secondary'): GitHubRateLimitedError =>
  new GitHubRateLimitedError(seconds, scope);

/** A promise a test settles by hand. */
export function gate(): { promise: Promise<undefined>; open: () => void } {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  return {
    promise,
    open: () => {
      resolve(undefined);
    },
  };
}

/** Lets everything that can run without a timer run. */
export const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** An attempt that answers from `outcomes` in turn (an error is thrown, a text is returned) and counts itself. */
export function scripted(...outcomes: (Error | string)[]): { attempt: () => Promise<string>; count: () => number } {
  const queue = [...outcomes];
  let count = 0;
  return {
    attempt: () => {
      count += 1;
      const next = queue.shift() ?? 'ok';
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    count: () => count,
  };
}
