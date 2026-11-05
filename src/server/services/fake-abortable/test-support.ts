// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// Two small helpers of `FakeGitHub` (../test-support.ts), kept apart so that the file of the fake's world stays under the size cap: waiting
// for a signal, and taking a scripted entry.

/**
 * What `work` returns, or a rejection with the reason of `signal` as soon as it aborts, whichever comes first. `work` starts
 * at once, aborted or not; it is a function so that the promise it makes is returned, never left dangling.
 */
export function abortable<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (signal === undefined) {
    return work();
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      try {
        signal.throwIfAborted();
      } catch (reason) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the reason of a signal is whatever the aborter passed, and the caller must get exactly that
        reject(reason);
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
  });
}

/** Removes and returns the first scripted entry for `method`, or undefined. */
export function takeFirst<T extends { readonly method: string }>(queue: T[], method: string): T | undefined {
  const index = queue.findIndex((entry) => entry.method === method);
  return index === -1 ? undefined : queue.splice(index, 1)[0];
}
