// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { Clock } from '../../services/ports/clock.ts';
import type { SessionStore } from '../db/sessions.ts';
import { readSessionCookie } from './session-cookie.ts';

// The hook that turns the session cookie into `request.auth` (E10-S02); auth.ts registers it.

/**
 * Looks the session up for a request. A cookie that cannot be a session id never reaches the database, and neither does a
 * route that is outside the rate limit (the webhook): it has no budget to cap the lookups, and it needs no caller. `touch`
 * runs on every authenticated request and is throttled by the store (E10-S01), so a busy page writes once a minute.
 */
export async function authenticate(request: FastifyRequest, store: SessionStore, clock: Clock): Promise<void> {
  if (request.routeOptions.config.rateLimit === false) {
    return;
  }
  const cookie = readSessionCookie(request.headers.cookie);
  request.sessionCookiePresented = cookie.kind !== 'absent';
  if (cookie.kind !== 'id') {
    return;
  }
  const now = clock.now();
  const found = await store.findLive(cookie.id, now);
  if (found === undefined) {
    return;
  }
  const session = await store.touch(found, now);
  request.auth = {
    user: session.user,
    sessionId: session.rowId,
    csrfSecret: session.csrfSecret,
    expiresAt: new Date(Math.min(session.idleExpiresAt.getTime(), session.absoluteExpiresAt.getTime())),
  };
}
