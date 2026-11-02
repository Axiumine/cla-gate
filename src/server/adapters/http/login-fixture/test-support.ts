// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import { z } from 'zod';
import { TEST_SESSION_SECRET } from '../../../config/auth-fixture/test-support.ts';

// What a test needs to read a login start (E10-S04) the way the callback will: the redirect to GitHub and the signed cookie
// that travels with it. The signature is checked here with HMAC-SHA256 spelled out, not by the code under test.

/** The cookie's name, spelled out on purpose: the tests assert the value the story specifies, not the constant. */
export const OAUTH_COOKIE_NAME = '__Host-cla_oauth';

/** The attributes the story fixes for the cookie, after its value. */
export const OAUTH_COOKIE_ATTRIBUTES = 'Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax';

const attemptSchema = z.strictObject({ s: z.string(), v: z.string(), r: z.string(), t: z.number() });

/** The cookie a login start set, taken apart. */
export interface SentAttempt {
  /** The whole `Set-Cookie` header. */
  readonly header: string;
  /** `{ s, v, r, t }`: state, verifier, the checked return path and when the attempt began (E10-S05 refuses an old one). */
  readonly attempt: z.infer<typeof attemptSchema>;
  /** Whether the signature is the HMAC-SHA256 of the value under the session secret. */
  readonly signedBySessionSecret: boolean;
  /** What a browser sends back in `Cookie`. */
  readonly cookie: string;
}

/** The whole header: the cookie's name, its value up to the first `;`, and exactly the attributes the story fixes. */
const SET_COOKIE = z.string().regex(new RegExp(`^${OAUTH_COOKIE_NAME}=[^;]+; ${OAUTH_COOKIE_ATTRIBUTES}$`));

/** Takes the `Set-Cookie` header of a login start apart; throws when it is not the attempt cookie with those attributes. */
export function sentAttempt(setCookie: string | string[] | number | undefined): SentAttempt {
  const header = SET_COOKIE.parse(setCookie);
  const encoded = header.slice(OAUTH_COOKIE_NAME.length + 1, header.indexOf(';'));
  const signed = decodeURIComponent(encoded);
  const dot = signed.lastIndexOf('.');
  const value = signed.slice(0, dot);
  const expected = crypto.createHmac('sha256', TEST_SESSION_SECRET).update(value).digest('base64').replaceAll('=', '');
  return {
    header,
    attempt: attemptSchema.parse(JSON.parse(value)),
    signedBySessionSecret: signed.slice(dot + 1) === expected,
    cookie: `${OAUTH_COOKIE_NAME}=${encoded}`,
  };
}
