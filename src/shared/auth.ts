// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from './github-id.ts';

/**
 * `GET /api/auth/session` when the caller is logged in (E10-S02). The identity is the numeric GitHub id; login, name
 * and avatar are display snapshots. The internal `users.id` never leaves the server, and neither does a token (the
 * SPA holds none).
 */
export const sessionResponseSchema = z.object({
  user: z.object({
    githubId: githubIdSchema,
    login: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  /** When the session ends unless it is used again: the earlier of the idle and the absolute expiry, ISO 8601. */
  expiresAt: z.iso.datetime(),
  /**
   * The CSRF token of this session (E10-S03): 43 base64url characters the SPA sends back in the `x-csrf-token` header on
   * every POST, PUT, PATCH and DELETE. It is derived from a per-session secret, so it changes with a new session.
   */
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
