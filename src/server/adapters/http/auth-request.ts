// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { SessionUser } from '../db/sessions.ts';

// Who is calling (E10-S02): one `onRequest` hook turns the session cookie into `request.auth`, and routes read nothing
// else. A session says who the person is (the numeric GitHub id) and nothing about tenants: what the person may do in an
// installation is decided per request by the guards built on this (E11).

/** The caller of a request that carries a live session. */
interface RequestAuth {
  /** `users.id` is the internal key for foreign keys (`published_by`, `created_by`); `githubId` is the identity. */
  readonly user: SessionUser;
  /** `sessions.id`, the handle of this session in logout (E10-S06). Not the cookie value. */
  readonly sessionId: number;
  /** The per-session secret the CSRF token derives from (E10-S03). */
  readonly csrfSecret: string;
  /** When the session ends unless used again: the earlier of the idle and the absolute expiry. */
  readonly expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The caller, or null when the request carries no live session. The only way a route reads who is calling. */
    auth: RequestAuth | null;
    /** True when the request sent a cookie of the session's name, usable or not: a dead one is then cleared (E10-S02). */
    sessionCookiePresented: boolean;
  }
}

/** The 401 that every protected route answers with; the error handler gives it the standard body (`code: unauthorized`). */
class UnauthorizedError extends Error {
  override readonly name = 'UnauthorizedError';
  readonly statusCode = 401;

  constructor() {
    super('Unauthorized');
  }
}

/**
 * The caller of a protected route.
 * @throws a 401 when the request carries no live session; E11 builds its guards on this.
 */
export function requireAuth(request: FastifyRequest): RequestAuth {
  if (request.auth === null) {
    throw new UnauthorizedError();
  }
  return request.auth;
}
