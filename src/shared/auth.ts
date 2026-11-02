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
});
