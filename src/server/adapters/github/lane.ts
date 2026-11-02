// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { RateLimitScope } from '../../services/ports/github-errors.ts';
import { PointBucket } from './point-bucket.ts';
import { Semaphore } from './semaphore.ts';

// What the rate limiter keeps for one installation, or for the App (E05-S05).

/** The lane a request counts in: an installation, or the App itself (requests signed with the App JWT). */
export type LaneScope = GithubId | 'app';

/** Requests of one lane in flight at once. */
const LANE_IN_FLIGHT = 10;

/** Points the bucket of a lane holds and gets back every minute; GitHub's secondary limit is 900 points a minute. */
const BUCKET_POINTS = 900;

/** What a request costs its lane: points from the bucket, and how long after the previous write it may start. */
export interface Kind {
  readonly points: number;
  readonly spacingMs: number;
}

/** A read costs 1 point and is never spaced. */
const READ: Kind = { points: 1, spacingMs: 0 };

/** A write costs 5 points and starts at least a second after the previous write of its lane (GitHub's advice). */
export const WRITE: Kind = { points: 5, spacingMs: 1000 };

/** A write is any method that can change something at GitHub. A route is `METHOD /path`. */
export function kindOf(route: string): Kind {
  const method = route.split(' ', 1)[0];
  return method === 'GET' || method === 'HEAD' ? READ : WRITE;
}

/** Everything the limiter keeps for one installation (or for the App). */
export class Lane {
  readonly inFlight = new Semaphore(LANE_IN_FLIGHT);
  /** A write holds this for its whole turn: writes of a lane are one at a time. */
  readonly writes = new Semaphore(1);
  readonly bucket: PointBucket;
  /** GitHub asked for no request before this time (epoch milliseconds); 0 when it did not. */
  blockedUntilMs = 0;
  blockedScope: RateLimitScope = 'secondary';
  lastWriteMs = Number.NEGATIVE_INFINITY;
  /** Requests of the lane that have been asked for and have not settled. */
  pending = 0;

  constructor(nowMs: number) {
    this.bucket = new PointBucket(BUCKET_POINTS, BUCKET_POINTS, nowMs);
  }

  /** The lane takes no request until the limit has run out; a shorter limit never shortens a longer one. */
  blockUntil(untilMs: number, scope: RateLimitScope): void {
    if (untilMs > this.blockedUntilMs) {
      this.blockedUntilMs = untilMs;
      this.blockedScope = scope;
    }
  }

  /** Takes the points of a request of `kind` and returns how long it waits first: for the spacing of writes, for the bucket. */
  paceMs(kind: Kind, nowMs: number): number {
    const spacingMs = kind.spacingMs > 0 ? this.lastWriteMs + kind.spacingMs - nowMs : 0;
    return Math.max(spacingMs, this.bucket.take(kind.points, nowMs));
  }

  /** True when the lane is in the state of a new one. */
  isIdle(nowMs: number): boolean {
    return this.pending === 0 && this.blockedUntilMs <= nowMs && this.bucket.isFull(nowMs);
  }
}

/** Lanes kept; past it the idle ones are forgotten (an idle lane is the same as a new one). */
const MAX_LANES = 1000;

/** The lanes by scope. Every request of a scope finds the same lane, so its limits are shared. */
export class Lanes {
  readonly #lanes = new Map<LaneScope, Lane>();

  /** How many lanes are kept. */
  get size(): number {
    return this.#lanes.size;
  }

  /** The lane of `scope`, a new one if there is none. A lane with requests pending is never forgotten. */
  of(scope: LaneScope, nowMs: number): Lane {
    const known = this.#lanes.get(scope);
    if (known !== undefined) {
      return known;
    }
    if (this.#lanes.size >= MAX_LANES) {
      this.#forgetIdle(nowMs);
    }
    const lane = new Lane(nowMs);
    this.#lanes.set(scope, lane);
    return lane;
  }

  #forgetIdle(nowMs: number): void {
    for (const [scope, lane] of this.#lanes) {
      if (lane.isIdle(nowMs)) {
        this.#lanes.delete(scope);
      }
    }
  }
}
