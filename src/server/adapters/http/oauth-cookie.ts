// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';

// The cookie that carries a login attempt from the login start to the callback (E10-S04). It is signed with
// `SESSION_SECRET` by the cookie plugin, so a value the browser or an attacker made up is refused at the callback.
// `__Host-` and `Secure` as for the session cookie; `SameSite=Lax` because GitHub brings the browser back with a
// cross-site top-level navigation, which a `Strict` cookie would not accompany.

const OAUTH_COOKIE = '__Host-cla_oauth';

/** The attempt lives for ten minutes: long enough to sign in at GitHub, short enough that an abandoned one is gone. */
const OAUTH_COOKIE_SECONDS = 600;

/** What the cookie holds, under the short keys the story names. */
export interface OauthCookie {
  /** The `state` sent to GitHub. */
  readonly s: string;
  /** The PKCE code verifier. */
  readonly v: string;
  /** The checked return path ({@link safeReturnTo}). */
  readonly r: string;
}

const ATTRIBUTES = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: OAUTH_COOKIE_SECONDS,
  signed: true,
} satisfies CookieSerializeOptions;

/** Sets the attempt cookie. A second login start overwrites it, so the callback of an earlier tab finds another state. */
export function setOauthCookie(reply: FastifyReply, attempt: OauthCookie): void {
  reply.setCookie(OAUTH_COOKIE, JSON.stringify(attempt), ATTRIBUTES);
}
