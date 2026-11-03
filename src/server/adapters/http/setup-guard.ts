// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SETUP_ERROR_CODES } from '../../../shared/setup.ts';
import { AppError } from './errors.ts';
import { readSetupCookie, setSetupCookie } from './setup-cookie.ts';
import { sameSecret } from './setup-digest.ts';
import type { SetupSession, SetupSessions } from './setup-sessions.ts';

// What every setup `POST` besides the unlock must prove (E19-S06), the counterpart of the guards of E10-S03 for a caller who
// has no login: that it comes from our own page (`Origin`), that it holds an unlocked setup session (the cookie) and that the
// page sent the session's CSRF token. The order is fixed, and each failure has a code of its own. The routes are on
// `SETUP_ROUTES`, so the global check of E10-S03 skips them and this one answers instead.

export interface SetupGuardDeps {
  /** The origin of `PUBLIC_BASE_URL`: the one origin a setup `POST` may come from. */
  readonly origin: string;
  readonly sessions: SetupSessions;
}

/**
 * The live setup session of the request, after the checks. A handler calls it first, so the body is read only for a caller
 * that passed them: a request from another site, or from nobody, learns nothing of how its input is read. A passing request
 * starts the idle time of the session over, in the store and in the cookie.
 * @throws AppError 403 `origin_mismatch` for an `Origin` that is missing or not ours, 401 `setup_locked` for a request with no
 * live session, 403 `csrf_invalid` for a missing or wrong token.
 */
export function requireSetupSession(request: FastifyRequest, reply: FastifyReply, deps: SetupGuardDeps): SetupSession {
  if (request.headers.origin !== deps.origin) {
    throw new AppError(403, SETUP_ERROR_CODES.originMismatch);
  }
  const session = deps.sessions.find(readSetupCookie(request));
  if (session === undefined) {
    throw new AppError(401, SETUP_ERROR_CODES.locked);
  }
  // `x-csrf-token` is `CSRF_HEADER` of the shared auth contract (E10-S03).
  if (!sameSecret(session.csrfToken, request.headers['x-csrf-token'])) {
    throw new AppError(403, 'csrf_invalid');
  }
  deps.sessions.renew(session);
  setSetupCookie(reply, session.id);
  return session;
}
