// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * Where time comes from (E05-S02). Code that needs "now" takes a `Clock` instead of calling `new Date()`, so a test
 * moves time by hand and a rule about minutes (a JWT reused for five, a token refreshed with five left) is tested
 * without waiting.
 */
export interface Clock {
  now(): Date;
}

/** The wall clock; the one implementation outside tests. */
export const systemClock: Clock = {
  now: () => new Date(),
};
