// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sign } from 'node:crypto';
import type { GitHubPrivateKey } from '../../config/github-key.ts';

/** `iat` is set this far in the past, so a clock that runs a little fast here does not make GitHub see a future token. */
const BACKDATE_SECONDS = 60;
/**
 * `exp` is this far ahead of now. With the backdate the lifetime is 600 s, GitHub's ceiling of ten minutes; `exp` itself
 * stays well inside the ten minutes GitHub allows from the moment it receives the token.
 */
const LIFETIME_SECONDS = 540;

const encode = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');

const HEADER = encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));

/**
 * Signs the JSON Web Token an App presents to GitHub (E05-S02): RS256 over `header.claims` with `node:crypto`, no JWT
 * library. `iss` is the App id, `iat` and `exp` are integer seconds. This is the one place that calls `reveal()` on a
 * signing key, and the token it returns is a credential: callers keep it out of logs and errors.
 * @param appId the numeric id of the GitHub App, as the text of the `iss` claim.
 * @param key the signing key; its PEM is revealed here and nowhere else.
 * @param nowSeconds whole seconds since the epoch, from the injected clock.
 */
export function signAppJwt(appId: string, key: GitHubPrivateKey, nowSeconds: number): string {
  const claims = { iat: nowSeconds - BACKDATE_SECONDS, exp: nowSeconds + LIFETIME_SECONDS, iss: appId };
  const signingInput = `${HEADER}.${encode(JSON.stringify(claims))}`;
  // 'sha256' with an RSA key is RSASSA-PKCS1-v1_5 with SHA-256, which is what the JWT algorithm RS256 means.
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), key.pem.reveal());
  return `${signingInput}.${signature.toString('base64url')}`;
}
