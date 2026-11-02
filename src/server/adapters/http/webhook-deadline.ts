// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AppError } from './errors.ts';

// The deadline of the webhook handler (E06-S07). GitHub gives a delivery 10 seconds and then counts it as failed; the
// handler answers by the 8th, so the failure is ours to report (`503` `webhook_timeout`) and the 10 seconds are never
// reached. Time is measured from the moment the request arrived, so a slow upload eats into the same budget.

/** Milliseconds. The handler answers `503` `webhook_timeout` when it has not finished by now, 2 seconds inside GitHub's limit. */
export const WEBHOOK_DEADLINE_MS = 8000;

/**
 * Runs `work` with a signal that aborts when `budgetMs` have passed; if `work` has not finished by then the result is a
 * `503` `webhook_timeout`. `work` is not stopped from outside (a statement already sent to the database runs to its end):
 * it is expected to look at the signal between its steps and to start no further one once it has aborted, so that the
 * transaction it holds is rolled back and nothing it started afterwards commits.
 *
 * @param budgetMs what is left of the deadline; zero or less expires at once
 * @param work the step to run, handed the signal that aborts at the deadline
 * @throws AppError `503` `webhook_timeout`
 */
export async function withDeadline<T>(budgetMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const expired = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    controller.abort();
    expired.reject(new AppError(503, 'webhook_timeout'));
  }, budgetMs);
  try {
    // The race keeps a handler on `work`: when it fails after the deadline (it stopped at the signal) nothing is unhandled.
    return await Promise.race([work(controller.signal), expired.promise]);
  } finally {
    clearTimeout(timer);
  }
}
