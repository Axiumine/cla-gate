// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

/** The most verified addresses a session keeps: GitHub lists more only for accounts that collect them. */
const MAX_VERIFIED_EMAILS = 20;

/**
 * One verified e-mail address of the person, as GitHub reported it at login (E10-S05) and as the signing page offers
 * it (E13). Personal data: it lives with the session row and nowhere else until the person signs.
 */
const verifiedEmailSchema = z.strictObject({
  email: z.string().min(1).max(320),
  primary: z.boolean(),
});

export const verifiedEmailsSchema = z.array(verifiedEmailSchema).max(MAX_VERIFIED_EMAILS);

export type VerifiedEmail = z.infer<typeof verifiedEmailSchema>;
