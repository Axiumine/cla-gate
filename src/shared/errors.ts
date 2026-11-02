// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

/** The optional `details` of an error body (E06-S01): a plain JSON object a domain error attaches to its code. */
export const errorDetailsSchema = z.record(z.string(), z.json());

/** Every error body the API sends: a stable machine code, a fixed human message, and the request id for support. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: errorDetailsSchema.optional(),
  }),
});
