// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

// The cookie of the setup session (E19-S06), the one place that names it. The value is the random id of an in-memory session
// (setup-sessions.ts), so it needs no signature. `__Host-` makes the browser accept it only with `Secure`, no `Domain` and
// `Path=/`; `SameSite=Strict` because nothing but our own page, on our own origin, has a reason to send it. The cookie plugin
// is registered by the setup routes, which are the only ones that read or set it.

const SETUP_COOKIE = '__Host-cla_setup';

/** How long the browser keeps the cookie after the last request: the idle lifetime of the session, 30 minutes. */
const SETUP_COOKIE_SECONDS = 1800;

const ATTRIBUTES = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: SETUP_COOKIE_SECONDS,
} satisfies CookieSerializeOptions;

/** Sets the cookie of a session, or sets it again with the idle lifetime started over. */
export function setSetupCookie(reply: FastifyReply, id: string): void {
  // The reply is a thenable that settles when the response is sent: the result of `setCookie` is dropped, never awaited.
  void reply.setCookie(SETUP_COOKIE, id, ATTRIBUTES);
}

/** The id the browser sent, or undefined when it sent no cookie of ours. */
export function readSetupCookie(request: FastifyRequest): string | undefined {
  const value: unknown = Reflect.get(request.cookies, SETUP_COOKIE);
  return typeof value === 'string' ? value : undefined;
}
