// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The values a query string may carry, read the same way by every route that takes them (E16-S02, E16-S03). A value that
// fails is a `400`, never a guess.

/** A positive integer written in plain digits: no sign, no leading zero, no exponent, within what a number holds exactly. */
export const idText = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.int().positive());

/**
 * An instant in ISO 8601 with an explicit offset or `Z`, at most to the millisecond: that is what the comparison with the
 * stored time is made at, and a bound with more digits would be rounded without telling the caller.
 */
export const instantText = z.iso
  .datetime({ offset: true })
  .refine((text) => !/\.\d{4,}/.test(text), { message: 'at most three decimals' })
  .transform((text) => new Date(text));
