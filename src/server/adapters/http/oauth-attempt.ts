// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash, randomBytes } from 'node:crypto';

// What one login attempt holds (E10-S04): a `state` that ties the callback to the browser that started the login, and a
// PKCE code verifier (RFC 7636) whose hash goes to GitHub now and whose plain value goes back with the code, so a stolen
// code is useless without the cookie that holds the verifier.

/** Random bytes in each of the state and the verifier: 256 bits, 43 characters of base64url. */
const RANDOM_BYTES = 32;

/** The authorization page of the GitHub App's user authorization. */
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

export interface LoginAttempt {
  /** Echoed back by GitHub on the callback, which must find the same value in the cookie. */
  readonly state: string;
  /** Kept in the cookie and sent with the code at the token exchange; never sent to the browser's address bar. */
  readonly verifier: string;
  /** `base64url(sha256(verifier))`: what the authorize URL carries. */
  readonly challenge: string;
}

/**
 * The `S256` challenge of a verifier: `base64url(sha256(verifier))`, hashing the verifier's ASCII text as RFC 7636 says.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** A fresh attempt: independent random state and verifier, and the challenge of the verifier. */
export function newLoginAttempt(): LoginAttempt {
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  return { state: randomBytes(RANDOM_BYTES).toString('base64url'), verifier, challenge: pkceChallenge(verifier) };
}

interface AuthorizeParts {
  readonly clientId: string;
  /** {@link callbackUrl} of the instance. */
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
}

/**
 * The GitHub authorize URL. No `scope` is sent: a GitHub App's user token has the permissions of the App and of the
 * person, and the OAuth scopes of an OAuth App mean nothing to it.
 */
export function authorizeUrl(parts: AuthorizeParts): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', parts.clientId);
  url.searchParams.set('redirect_uri', parts.redirectUri);
  url.searchParams.set('state', parts.state);
  url.searchParams.set('code_challenge', parts.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}
