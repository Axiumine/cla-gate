// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** Waits `milliseconds` on a timer. The default of every wait in the GitHub adapter; tests inject their own. */
export const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
