// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

/** The most verified addresses a session keeps: GitHub lists more only for accounts that collect them. */
const MAX_VERIFIED_EMAILS = 20;

/** Whether a database `jsonb` can keep the text: it refuses a NUL character and a lone surrogate (written as an escape it cannot translate). */
const storable = (text: string): boolean => !text.includes('\0') && text.isWellFormed();

/** An e-mail address as GitHub reports it: 1 to 320 characters, as given, and text the session row can hold. */
export const emailAddressSchema = z.string().min(1).max(320).refine(storable, 'not storable text');

/**
 * One verified e-mail address of the person, as GitHub reported it at login (E10-S05) and as the signing page offers
 * it (E13). Personal data: it lives with the session row and nowhere else until the person signs.
 */
const verifiedEmailSchema = z.strictObject({
  email: emailAddressSchema,
  primary: z.boolean(),
});

export const verifiedEmailsSchema = z.array(verifiedEmailSchema).max(MAX_VERIFIED_EMAILS);

export type VerifiedEmail = z.infer<typeof verifiedEmailSchema>;
