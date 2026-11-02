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

/**
 * The optional JSON body of `POST /api/auth/logout` (E10-S06): `everywhere: true` ends every session of the caller, the
 * default ends the one in use. Strict, so a key nobody defined (a `userId` somebody hopes will be believed) is a 400. The
 * body may be absent altogether.
 */
export const logoutRequestSchema = z.strictObject({ everywhere: z.boolean().optional() }).optional();

/**
 * Why a login ended at `/login/failed` (E10-S05). The server redirects with `?reason=<one of these>`; the screen (E17)
 * reads the same list, so a code added on one side cannot be missed on the other.
 * @internal Exported for the unit tests and for the login-failed screen (E17); Knip ignores `@internal` exports in production mode until that story imports it.
 */
export const loginFailureReasonSchema = z.enum([
  'state_mismatch',
  'access_denied',
  'exchange_failed',
  'github_unavailable',
  'unsupported_account',
  'bad_request',
]);

export type LoginFailureReason = z.infer<typeof loginFailureReasonSchema>;

/** The path of the login-failed screen (E17) that the login callback redirects to. */
export function loginFailedPath(reason: LoginFailureReason): string {
  return `/login/failed?reason=${reason}`;
}
