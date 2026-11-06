// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The moments of the audit range (E18-S09): what a person types or an address holds, and the one form the server is asked with.
// Every moment is in UTC; a text with an offset is not one of them, so a local time is never taken for a UTC one.

/** The longest fraction of a second the server compares at: a bound with more digits would be rounded without telling anyone. */
const MAX_FRACTION = /\.\d{4,}/;

/** The time a date without a time stands for: the start of that day in UTC. */
const START_OF_DAY = 'T00:00:00.000Z';

/**
 * A date (`2026-11-01`, the start of that day) or an instant that ends in `Z` (`2026-11-01T09:30:00Z`), at most to the millisecond,
 * as the canonical text the server is asked with (`2026-11-01T09:30:00.000Z`). Anything else, an offset and a date that does not
 * exist included, is not an instant.
 */
export const instantText = z
  .union([z.iso.date().transform((date) => `${date}${START_OF_DAY}`), z.iso.datetime()])
  .refine((text) => !MAX_FRACTION.test(text), { message: 'at most three decimals' })
  .transform((text) => new Date(text).toISOString());

/**
 * The shortest text that `instantText` reads back as `instant`: the date when it is the start of a day, the time without the
 * thousandths when they are zero, else the whole instant.
 */
export function instantDisplay(instant: string): string {
  if (instant.endsWith(START_OF_DAY)) {
    return instant.slice(0, instant.indexOf('T'));
  }
  return instant.endsWith('.000Z') ? `${instant.slice(0, -5)}Z` : instant;
}

/** Whether the range from `from` to `to` ends before it starts; a range with a side missing never does. */
export function endsBeforeStart(from: string | undefined, to: string | undefined): boolean {
  return from !== undefined && to !== undefined && Date.parse(to) < Date.parse(from);
}
