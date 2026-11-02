// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

// The cookie that carries a login attempt from the login start to the callback (E10-S04). It is signed with
// `SESSION_SECRET` by the cookie plugin, so a value the browser or an attacker made up is refused at the callback.
// `__Host-` and `Secure` as for the session cookie; `SameSite=Lax` because GitHub brings the browser back with a
// cross-site top-level navigation, which a `Strict` cookie would not accompany.

const OAUTH_COOKIE = '__Host-cla_oauth';

/** The attempt lives for ten minutes: long enough to sign in at GitHub, short enough that an abandoned one is gone. */
const OAUTH_COOKIE_SECONDS = 600;

const MS_PER_SECOND = 1000;

/** What the cookie holds, under short keys. */
export interface OauthCookie {
  /** The `state` sent to GitHub. */
  readonly s: string;
  /** The PKCE code verifier. */
  readonly v: string;
  /** The checked return path ({@link safeReturnTo}). */
  readonly r: string;
  /** When the attempt started, in milliseconds since the epoch: the callback refuses an attempt older than the cookie's life (E10-S05). */
  readonly t: number;
}

const cookieSchema = z.strictObject({ s: z.string().min(1), v: z.string().min(1), r: z.string(), t: z.int() });

const ATTRIBUTES = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: OAUTH_COOKIE_SECONDS,
  signed: true,
} satisfies CookieSerializeOptions;

/**
 * Sets the attempt cookie, stamped with `now`. A second login start overwrites it, so the callback of an earlier tab finds
 * another state.
 */
export function setOauthCookie(reply: FastifyReply, attempt: Omit<OauthCookie, 't'>, now: Date): void {
  const { s, v, r } = attempt;
  const value: OauthCookie = { s, v, r, t: now.getTime() };
  reply.setCookie(OAUTH_COOKIE, JSON.stringify(value), ATTRIBUTES);
}

/** Tells the browser to forget the attempt: the same attributes with an empty value and `Max-Age=0`. */
export function clearOauthCookie(reply: FastifyReply): void {
  reply.setCookie(OAUTH_COOKIE, '', { ...ATTRIBUTES, signed: false, maxAge: 0 });
}

/** The text as JSON, or undefined when it is not. */
function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * The attempt the browser sent back, or undefined when there is none worth trusting: no cookie, a signature that does not
 * verify (a value made up or tampered with, or signed under another secret), a value of another shape, or an attempt older
 * than {@link OAUTH_COOKIE_SECONDS} (the browser drops the cookie by then; a client that sends it anyway is refused here).
 */
export function readOauthCookie(request: FastifyRequest, now: Date): OauthCookie | undefined {
  const raw: unknown = Reflect.get(request.cookies, OAUTH_COOKIE);
  if (typeof raw !== 'string') {
    return undefined;
  }
  const unsigned = request.unsignCookie(raw);
  const parsed = unsigned.valid ? cookieSchema.safeParse(parseJson(unsigned.value)) : undefined;
  if (parsed?.success !== true) {
    return undefined;
  }
  const age = now.getTime() - parsed.data.t;
  return age >= 0 && age < OAUTH_COOKIE_SECONDS * MS_PER_SECOND ? parsed.data : undefined;
}
