// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Secret } from '../../config/secret.ts';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { LoginFailure } from '../../services/ports/github-login.ts';
import { readJson } from './github-http.ts';

// What every call of the login shares (E10-S05): one place that sets the timeout, refuses redirects and turns a broken
// connection into an outage, so that the token endpoint, the identity and the revocation fail the same way.

/** The ceiling of every call, so a hung GitHub holds a login for seconds, not for ever. */
export const LOGIN_TIMEOUT_MS = 10_000;

export interface GithubLoginOptions {
  /** The GitHub App's client id. */
  readonly clientId: string;
  readonly clientSecret: Secret;
  /** The callback URL, repeated at the exchange as the OAuth standard asks. */
  readonly redirectUri: string;
  readonly timeoutMs: number;
  /** Defaults to the global `fetch`, read at call time so a test that intercepts it later is seen. */
  readonly fetch?: typeof fetch | undefined;
}

/** 5xx and 429 are GitHub's trouble, retried by the person pressing the button again; any other refusal is a verdict on the request. */
const isOutage = (status: number): boolean => status >= 500 || status === 429;

/** Sends one request; nothing but the headers, the body and the timeout decide its shape. @throws LoginFailure when no answer comes. */
export async function send(options: GithubLoginOptions, url: string, init: RequestInit): Promise<Response> {
  try {
    return await (options.fetch ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    throw new LoginFailure('github_unavailable');
  }
}

/** The JSON body of an answer. @throws LoginFailure: `github_unavailable` when it breaks off, `bad_request` when it is not JSON. */
async function bodyOf(response: Response, route: string): Promise<unknown> {
  try {
    return await readJson(response, route);
  } catch (error) {
    throw new LoginFailure(error instanceof GitHubUnavailableError ? 'github_unavailable' : 'bad_request');
  }
}

/** A successful answer's JSON body; any other status is a failure. @throws LoginFailure. */
export async function okBody(response: Response, route: string): Promise<unknown> {
  if (!response.ok) {
    throw new LoginFailure(isOutage(response.status) ? 'github_unavailable' : 'exchange_failed');
  }
  return bodyOf(response, route);
}
