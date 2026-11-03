// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import { AppError } from './errors.ts';

// A route of the CLA documents API reads its body and its query with `parseInput` and not through a route schema: Fastify
// validates a route schema before the `Origin`, session and CSRF checks of E10-S03 and before the guard of the tenant
// (E11-S05) run, so a request from another site, or without a session, or for a tenant it may not know, would learn how its
// input was read. The checks and the guard run first, then the handler reads `request.body` or `request.query` here.

/**
 * `input` (a parsed body or query) read with `schema`.
 * @throws AppError 400 `bad_request` when it is not what `schema` describes, and when there is no input at all.
 */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, 'bad_request');
  }
  return parsed.data;
}
