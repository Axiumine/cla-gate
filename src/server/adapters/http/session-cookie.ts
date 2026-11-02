// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';

// The session cookie (E10-S02), the one place that names it. `__Host-` makes the browser accept it only with `Secure`, no
// `Domain` and `Path=/`, so a sibling sub-domain cannot plant one. `Secure` and the prefix are used in every
// environment: Chromium and Firefox treat http://localhost as secure, Safari needs an HTTPS tunnel for local work.

const SESSION_COOKIE = '__Host-cla_session';

/** A session id is 32 random bytes in base64url: exactly 43 characters. Anything else is not worth a database query. */
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

const ATTRIBUTES = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } satisfies CookieSerializeOptions;

/**
 * Sets the session cookie for a freshly created session. `Max-Age` is the absolute lifetime: the browser drops the cookie
 * when the session can no longer be alive, whatever the idle expiry did.
 * @internal Exported for the unit tests and for the login callback (E10-S05); Knip ignores `@internal` exports in production mode until that route imports it.
 */
export function setSessionCookie(reply: FastifyReply, id: string, absoluteSeconds: number): void {
  reply.setCookie(SESSION_COOKIE, id, { ...ATTRIBUTES, maxAge: absoluteSeconds });
}

/** Tells the browser to forget the session cookie: the same attributes with an empty value and `Max-Age=0`. */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, '', { ...ATTRIBUTES, maxAge: 0 });
}

/** What a `Cookie` header says about the session: no cookie of ours, one that cannot be a session id, or the id. */
export type SessionCookie =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unusable' }
  | { readonly kind: 'id'; readonly id: string };

/** The values of every cookie called {@link SESSION_COOKIE} in a `Cookie` header, in order (names are case-sensitive). */
function sessionCookieValues(header: string): string[] {
  return header.split(';').flatMap((pair) => {
    const separator = pair.indexOf('=');
    return separator >= 0 && pair.slice(0, separator).trim() === SESSION_COOKIE
      ? [pair.slice(separator + 1).trim()]
      : [];
  });
}

/**
 * The session cookie in a `Cookie` header. Two cookies of the same name are ambiguous, and which one a browser sent first
 * is not something to authenticate on, so they count as unusable; so does a value that is not 43 base64url characters.
 * Only this function reads the cookie: routes read `request.auth`.
 */
export function readSessionCookie(header: string | undefined): SessionCookie {
  const values = sessionCookieValues(header ?? '');
  const [value] = values;
  if (value === undefined) {
    return { kind: 'absent' };
  }
  return values.length === 1 && SESSION_ID.test(value) ? { kind: 'id', id: value } : { kind: 'unusable' };
}
