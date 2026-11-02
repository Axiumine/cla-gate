// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Secret } from '../../config/secret.ts';
import { verifiedOnly } from '../../domain/github-profile.ts';
import { type GithubLogin, LoginFailure, type RevokeResult } from '../../services/ports/github-login.ts';
import { apiHeaders } from './api-headers.ts';
import { GITHUB_API_ORIGIN } from './github-http.ts';
import { accountTypeSchema, emailsSchema, tokenErrorSchema, tokenSchema, userSchema } from './user-login-schemas.ts';
import { type GithubLoginOptions, okBody, send } from './user-login-transport.ts';

// The GitHub App's user authorization over plain `fetch` (E10-S05): the code exchange, the identity and the revocation.
// The token goes into one header per call and nowhere else; no URL, log line, error message or return value carries it
// but the `Secret` that the caller holds. A redirect is refused so that the credentials never follow one.

const TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** The token endpoint's request: the code with the verifier that proves this browser started the login. */
function exchangeInit(options: GithubLoginOptions, code: string, verifier: string): RequestInit {
  const form = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret.reveal(),
    code,
    redirect_uri: options.redirectUri,
    code_verifier: verifier,
  });
  return {
    method: 'POST',
    headers: { ...apiHeaders(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  };
}

async function exchange(options: GithubLoginOptions, code: string, verifier: string): Promise<Secret> {
  const response = await send(options, TOKEN_URL, exchangeInit(options, code, verifier));
  const body = await okBody(response, 'POST /login/oauth/access_token');
  if (tokenErrorSchema.safeParse(body).success) {
    throw new LoginFailure('exchange_failed');
  }
  const token = tokenSchema.safeParse(body);
  if (!token.success) {
    throw new LoginFailure('bad_request');
  }
  return new Secret(token.data);
}

/** One `GET` of the API as the signing-in person. */
async function getAsUser(options: GithubLoginOptions, token: Secret, path: string): Promise<unknown> {
  const headers = { ...apiHeaders(), authorization: `Bearer ${token.reveal()}` };
  const response = await send(options, `${GITHUB_API_ORIGIN}${path}`, { method: 'GET', headers });
  return okBody(response, `GET ${new URL(path, GITHUB_API_ORIGIN).pathname}`);
}

async function identity(options: GithubLoginOptions, token: Secret) {
  const raw = await getAsUser(options, token, '/user');
  const account = accountTypeSchema.safeParse(raw);
  if (!account.success) {
    throw new LoginFailure('bad_request');
  }
  if (account.data.type !== 'User') {
    throw new LoginFailure('unsupported_account');
  }
  const user = userSchema.safeParse(raw);
  const emails = emailsSchema.safeParse(await getAsUser(options, token, '/user/emails?per_page=100'));
  if (!user.success || !emails.success) {
    throw new LoginFailure('bad_request');
  }
  return { ...user.data, verifiedEmails: verifiedOnly(emails.data) };
}

/** `DELETE /applications/{client_id}/token`: Basic authentication with the client credentials, the token in the body. */
async function revoke(options: GithubLoginOptions, token: Secret): Promise<RevokeResult> {
  const basic = Buffer.from(`${options.clientId}:${options.clientSecret.reveal()}`).toString('base64');
  try {
    const response = await send(
      options,
      `${GITHUB_API_ORIGIN}/applications/${encodeURIComponent(options.clientId)}/token`,
      {
        method: 'DELETE',
        headers: { ...apiHeaders(), authorization: `Basic ${basic}`, 'content-type': 'application/json' },
        body: JSON.stringify({ access_token: token.reveal() }),
      },
    );
    return response.status === 204 ? { ok: true } : { ok: false, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

/** The login's GitHub calls over `fetch`, bound to this instance's client credentials. */
export function createGithubLogin(options: GithubLoginOptions): GithubLogin {
  return {
    exchange: (code, verifier) => exchange(options, code, verifier),
    identity: (token) => identity(options, token),
    revoke: (token) => revoke(options, token),
  };
}
