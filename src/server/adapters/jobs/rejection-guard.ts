// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';

// What a promise that rejects with nobody waiting for it does to a job (E07-S03). A handler that throws, or whose returned
// promise rejects, fails its job through `runJob`. A promise the handler started and did not wait for is another thing: when it
// rejects, Node raises `unhandledRejection` and, with no listener, stops the process, and every other job in it with it. The
// guard keeps the process up and puts the failure where it belongs: the job whose handler (or whose callbacks, timers and
// promises) started the promise fails, and the queue retries it by its bounds (E07-S05).

/** The job whose code is running: how to fail it, and the logger to tell it on. */
interface RunningJob {
  readonly fail: (reason: unknown) => void;
  readonly logger: Logger;
}

const running = new AsyncLocalStorage<RunningJob>();

/**
 * Runs `work` as one job. The promise settles with what `work` settles with, or rejects with the reason of an unhandled rejection
 * that comes from the code `work` started, the first time one does while the job is running. A rejection that comes after
 * the job has settled changes nothing: it is logged on `logger` as `job.unhandled_rejection` and the process goes on.
 */
export function failOnUnhandledRejection<T>(logger: Logger, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    running.run({ fail: reject, logger }, () => {
      work().then(resolve, reject);
    });
  });
}

/**
 * The listener of `unhandledRejection`: a rejection that comes from the code of a job (found by the async context, which
 * follows promises, timers and callbacks) is logged and fails that job. A rejection from anywhere else is thrown again, which is
 * what Node does when nobody listens: an uncaught exception, so the process stops as it would have without the guard.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export function onUnhandledRejection(reason: unknown): void {
  const job = running.getStore();
  if (job === undefined) {
    throw reason instanceof Error ? reason : new Error(`unhandled rejection: ${String(reason)}`);
  }
  job.logger.error({ err: reason }, 'job.unhandled_rejection');
  job.fail(reason);
}

let users = 0;

/**
 * How many users of the guard there are now.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export function rejectionGuardUsers(): number {
  return users;
}

/**
 * Starts the guard for this process, for as long as jobs run, and returns what ends this use of it. The process has one
 * listener however many queues use the guard; it is removed when the last of them has released it, and releasing twice counts once.
 */
export function installRejectionGuard(): () => void {
  users += 1;
  if (users === 1) {
    process.on('unhandledRejection', onUnhandledRejection);
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    users -= 1;
    if (users === 0) {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  };
}
