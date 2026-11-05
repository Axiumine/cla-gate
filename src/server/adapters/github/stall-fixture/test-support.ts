// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The stall of the mocked GitHub (E05-S07): the next `GET /app/installations/{id}` is held back until the test lets it go.

/** The held request: `arrived` is called as it comes in, and the answer waits for `released`. */
export interface Stall {
  readonly arrived: () => void;
  readonly released: Promise<void>;
}

/** The next `GET /app/installations/{id}` is answered when the test lets it go; `arrived` settles when it is waiting. */
export function stallNext(world: { stall?: Stall | undefined }): {
  readonly arrived: Promise<void>;
  readonly release: () => void;
} {
  const arrived = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  world.stall = {
    arrived: () => {
      arrived.resolve(undefined);
    },
    released: released.promise,
  };
  return {
    arrived: arrived.promise,
    release: () => {
      released.resolve(undefined);
    },
  };
}
