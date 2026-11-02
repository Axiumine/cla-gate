// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { Clock } from '../../services/ports/clock.ts';
import { GitHubRateLimitedError } from '../../services/ports/github-errors.ts';
import { type Kind, kindOf, type Lane, type LaneScope, Lanes, WRITE } from './lane.ts';
import { pause } from './pause.ts';
import { Semaphore } from './semaphore.ts';
import { isWorthWaiting, MAX_WAIT_SECONDS } from './wait-policy.ts';

// How the platform treats GitHub's limits (E05-S05). Every request of the Octokit adapter runs through here, in the lane
// of the installation it is made for (or the App's own lane), so one installation that is limited never delays another.
//
// A request waits for its turn in this order: the write gate (a write is alone in its lane), the lane's block (a limit
// GitHub answered with), the spacing between writes, the point bucket, a place in the lane (10 at once) and a place
// overall (50 at once; GitHub allows 100). When GitHub answers with a limit the lane is blocked until the end of the
// wait. A wait of 60 s or less is slept and the request repeated, twice at most; a longer one is raised at once as
// GitHubRateLimitedError, and so is every later request of the lane until the block ends, without sleeping or asking
// GitHub (the job layer, E07-S03, decides the retry).

/** Requests in flight at once over all lanes. GitHub allows 100 concurrent requests; half of it is left to others. */
const OVERALL_IN_FLIGHT = 50;

export interface RateLimiterOptions {
  readonly clock: Clock;
  readonly logger: Logger;
  /** Waits; defaults to a timer. Tests record the waits instead of sitting through them. */
  readonly sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

/**
 * The concurrency, pacing and rate-limit rules of the GitHub client, per installation. State is in memory: one
 * instance of the server has one limiter, and a restart forgets the blocks (GitHub answers a limit again if it still
 * applies).
 */
export class RateLimiter {
  /** The clock the limiter measures time with; the adapter measures a limit's reset time against it too. */
  readonly clock: Clock;
  readonly #logger: Logger;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #lanes = new Lanes();
  readonly #overall = new Semaphore(OVERALL_IN_FLIGHT);

  constructor(options: RateLimiterOptions) {
    this.clock = options.clock;
    this.#logger = options.logger;
    this.#sleep = options.sleep ?? pause;
  }

  /** How many lanes are kept. */
  get lanes(): number {
    return this.#lanes.size;
  }

  /**
   * Runs `attempt` (one request to `route`, a template such as `GET /repositories/{repository_id}`) in the lane of
   * `scope`, and again after a short limit. `attempt` throws {@link GitHubRateLimitedError} when GitHub answers with
   * a limit; any other failure is not the limiter's and goes on unchanged.
   * @throws GitHubRateLimitedError for a limit of more than 60 s, for a lane that is blocked for more than 60 s, and for
   * the third limit in a row.
   */
  async run<T>(scope: LaneScope, route: string, attempt: () => Promise<T>): Promise<T> {
    const lane = this.#lanes.of(scope, this.#nowMs());
    lane.pending += 1;
    try {
      for (let repeats = 0; ; repeats += 1) {
        try {
          return await this.#turn(lane, kindOf(route), attempt);
        } catch (error) {
          this.#waitOrThrow({ scope, route, repeats }, error);
        }
      }
    } finally {
      lane.pending -= 1;
    }
  }

  /** Returns when `error` is a limit worth waiting out (it is logged); throws it, or any other failure, when not. */
  #waitOrThrow(request: { scope: LaneScope; route: string; repeats: number }, error: unknown): void {
    if (!isWorthWaiting(error, request.repeats)) {
      throw error;
    }
    this.#logger.warn(
      {
        scope: error.scope,
        waitSeconds: error.retryAfterSeconds,
        route: request.route,
        installationId: request.scope === 'app' ? null : request.scope,
      },
      'github.rate_limited',
    );
  }

  #nowMs(): number {
    return this.clock.now().getTime();
  }

  /** One go at a request: the write gate, then everything else. A write is alone in its lane. */
  #turn<T>(lane: Lane, kind: Kind, attempt: () => Promise<T>): Promise<T> {
    return kind === WRITE
      ? lane.writes.run(() => this.#admitted(lane, kind, attempt))
      : this.#admitted(lane, kind, attempt);
  }

  async #admitted<T>(lane: Lane, kind: Kind, attempt: () => Promise<T>): Promise<T> {
    await this.#untilUnblocked(lane);
    await this.#pace(lane, kind);
    return lane.inFlight.run(() =>
      this.#overall.run(() => {
        if (kind === WRITE) {
          lane.lastWriteMs = this.#nowMs();
        }
        return this.#blockOnLimit(lane, attempt);
      }),
    );
  }

  /**
   * Runs the request; when GitHub answers with a limit the lane is blocked at once, before the request gives its place
   * back, so the request behind it in line finds the block instead of running into the same limit.
   */
  async #blockOnLimit<T>(lane: Lane, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof GitHubRateLimitedError) {
        lane.blockUntil(this.#nowMs() + error.retryAfterSeconds * 1000, error.scope);
      }
      throw error;
    }
  }

  /** Sleeps out the rest of a limit of 60 s or less; a longer one is raised without waiting. */
  async #untilUnblocked(lane: Lane): Promise<void> {
    const remainingMs = lane.blockedUntilMs - this.#nowMs();
    if (remainingMs <= 0) {
      return;
    }
    const seconds = Math.ceil(remainingMs / 1000);
    if (seconds > MAX_WAIT_SECONDS) {
      throw new GitHubRateLimitedError(seconds, lane.blockedScope);
    }
    await this.#sleep(remainingMs);
  }

  /** Waits for the spacing between writes and for the bucket to cover the request's points. */
  async #pace(lane: Lane, kind: Kind): Promise<void> {
    const waitMs = lane.paceMs(kind, this.#nowMs());
    if (waitMs > 0) {
      await this.#sleep(waitMs);
    }
  }
}
