// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { type EnvelopeOf, JOB_TYPES, type JobType } from '../domain/job-envelope.ts';

// The handler registry (E07-S03): which function runs a job of which type. The workers ask it; an epic that owns a job
// registers its handler through `register` from its own composition code, so adding a handler edits no file of the
// queue, the wrapper or the other handlers (E10-S07 does so for `revoke-user-sessions`).

/** What a handler reports when it ends without failing: one word that says what happened (`synced`, `skipped`, ...). */
export interface JobOutcome {
  readonly outcome: string;
}

/** What a handler is given besides the validated envelope of its job. */
export interface JobContext {
  /** The id of the job on the queue. */
  readonly jobId: string;
  /** How often the job was retried before this run: 0 for the first. */
  readonly attempt: number;
  /**
   * Aborts when the job must stop (the shutdown deadline, E07-S03, or the expiry of the job). A handler hands it on to
   * every GitHub call (`GitHubClient.withSignal`) and stops when it aborts; a job that was aborted is failed by the
   * queue and runs again after a restart, so a handler must be safe to run twice.
   */
  readonly signal: AbortSignal;
  /** A logger that already carries the job id, type and numeric ids. */
  readonly logger: Logger;
}

/**
 * The handler of the job type `T`. It resolves with the outcome, or rejects: the job then fails, and the queue retries it
 * with backoff until the retries are spent (E07-S05). A handler never catches what it cannot settle (a rate limit that
 * GitHub's client refused to wait out, a database outage): retrying is the queue's work, and holding a worker for it is not.
 */
export type JobHandler<T extends JobType> = (job: EnvelopeOf<T>, context: JobContext) => Promise<JobOutcome>;

/** The handlers by job type: a type without one has no consumer, and its queue keeps its jobs. */
type Handlers = { readonly [T in JobType]?: JobHandler<T> };

/**
 * Thrown by {@link HandlerRegistry.register} for a type that already has a handler: two epics must not both own a job.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export class HandlerRegisteredError extends Error {
  override readonly name = 'HandlerRegisteredError';

  constructor(type: JobType) {
    super(`A handler is already registered for ${type}`);
  }
}

/**
 * Thrown by {@link HandlerRegistry.run} for a type nobody registered.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export class HandlerMissingError extends Error {
  override readonly name = 'HandlerMissingError';

  constructor(type: JobType) {
    super(`No handler is registered for ${type}`);
  }
}

export class HandlerRegistry {
  #handlers: Handlers = {};

  /** The handler of `type`, if there is one. */
  #handlerOf<T extends JobType>(type: T): Handlers[T] {
    // eslint-disable-next-line security/detect-object-injection -- type is a JobType of the catalogue, not input
    return this.#handlers[type];
  }

  /**
   * Binds `handler` to the job type `type`.
   * @throws HandlerRegisteredError when the type has one.
   */
  register<T extends JobType>(type: T, handler: JobHandler<T>): void {
    if (this.#handlerOf(type) !== undefined) {
      throw new HandlerRegisteredError(type);
    }
    this.#handlers = { ...this.#handlers, [type]: handler };
  }

  /** The job types that have a handler, in the order of the catalogue. */
  types(): JobType[] {
    return JOB_TYPES.filter((type) => this.#handlerOf(type) !== undefined);
  }

  /**
   * Runs the handler of `type`.
   * @throws HandlerMissingError for a type without one.
   */
  run<T extends JobType>(type: T, job: EnvelopeOf<T>, context: JobContext): Promise<JobOutcome> {
    const handler = this.#handlerOf(type);
    return handler === undefined ? Promise.reject(new HandlerMissingError(type)) : handler(job, context);
  }
}
