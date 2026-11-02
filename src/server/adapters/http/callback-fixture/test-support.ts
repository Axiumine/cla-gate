// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { onTestFinished } from 'vitest';
import { z } from 'zod';
import { TEST_CLIENT_ID, TEST_CLIENT_SECRET } from '../../../config/auth-fixture/test-support.ts';
import { type AuthWorld, authWorld } from '../auth-fixture/test-support.ts';
import { type SentAttempt, sentAttempt } from '../login-fixture/test-support.ts';

// A GitHub that behaves like the real one for the three calls of the login (E10-S05), and a world to run the login against
// it. The code is bound to the client, the redirect URI and the PKCE challenge of the authorize URL it was granted for and
// works once, as GitHub's does; a token works until it is revoked. Everything is made up.

const GITHUB = 'https://github.com';
const API = 'https://api.github.com';

/** One request GitHub received, with the body as text. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A GitHub account as `GET /user` and `GET /user/emails` describe it. */
export interface FakeAccount {
  id: number;
  login: string;
  type: string;
  name: string | null;
  avatarUrl: string | null;
  emails: { email: string; primary: boolean; verified: boolean }[];
}

/** Alice: a user with a primary and a second verified address and one that is not verified. */
export const ALICE: FakeAccount = {
  id: 1001,
  login: 'alice',
  type: 'User',
  name: 'Alice Example',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1001?v=4',
  emails: [
    { email: 'alice@example.org', primary: true, verified: true },
    { email: 'alice.work@example.org', primary: false, verified: true },
    { email: 'alice.old@example.org', primary: false, verified: false },
  ],
};

/** A response, or a promise of one: what a route answers with. */
type Answer = () => Response | Promise<Response>;

/** What a test can change in the GitHub it signs in at. */
export interface FakeGithub {
  /** The account the next authorizations sign in as. */
  account: FakeAccount;
  /** A route that answers something other than GitHub's usual: set the one under test, leave the rest. */
  readonly answer: { token?: Answer; user?: Answer; emails?: Answer; revoke?: Answer };
  /** Every request that reached GitHub, in order. */
  readonly requests: SentRequest[];
  /** The access tokens GitHub was asked to revoke. */
  readonly revoked: string[];
  /** The access tokens GitHub issued. */
  readonly issued: string[];
  /** The person clicks "Authorize" on the page `authorizeUrl` names; returns the code GitHub sends back to the callback. */
  readonly grant: (authorizeUrl: string) => string;
}

interface Grant {
  readonly account: FakeAccount;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  used: boolean;
}

interface State {
  account: FakeAccount;
  readonly answer: FakeGithub['answer'];
  readonly requests: SentRequest[];
  readonly revoked: string[];
  readonly issued: string[];
  readonly grants: Map<string | null, Grant>;
  readonly tokens: Map<string, FakeAccount>;
}

const CREDENTIALS = Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString('base64');
const BASIC = `Basic ${CREDENTIALS}`;

/** GitHub answers a failed exchange with 200 and an `error`. */
const exchangeError = (error: string): Response => HttpResponse.json({ error, error_description: 'made up' });

/** The exchange as GitHub checks it: the code, the client, the redirect URI and the PKCE verifier. */
function exchange(state: State, form: URLSearchParams): Response {
  const grant = state.grants.get(form.get('code'));
  if (grant === undefined || grant.used) {
    return exchangeError('bad_verification_code');
  }
  if (form.get('client_id') !== TEST_CLIENT_ID || form.get('client_secret') !== TEST_CLIENT_SECRET) {
    return exchangeError('incorrect_client_credentials');
  }
  if (form.get('redirect_uri') !== grant.redirectUri || grant.clientId !== TEST_CLIENT_ID) {
    return exchangeError('redirect_uri_mismatch');
  }
  const verifier = String(form.get('code_verifier'));
  if (crypto.createHash('sha256').update(verifier).digest('base64url') !== grant.challenge) {
    return exchangeError('bad_verification_code');
  }
  grant.used = true;
  const token = `ghu_made-up-${state.issued.length + 1}`;
  state.issued.push(token);
  state.tokens.set(token, grant.account);
  return HttpResponse.json({
    access_token: token,
    token_type: 'bearer',
    scope: '',
    expires_in: 28800,
    refresh_token: 'ghr_made-up-refresh',
    refresh_token_expires_in: 15811200,
  });
}

/** The account a request's bearer token belongs to, or undefined: unknown, revoked or missing. */
function bearerAccount(state: State, request: Request): FakeAccount | undefined {
  const token = String(request.headers.get('authorization')).replace(/^Bearer /, '');
  return state.revoked.includes(token) ? undefined : state.tokens.get(token);
}

const badCredentials = (): Response => HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });

function userBody(account: FakeAccount): Record<string, unknown> {
  return {
    login: account.login,
    id: account.id,
    node_id: 'MDQ6VXNlcjEwMDE=',
    avatar_url: account.avatarUrl,
    type: account.type,
    site_admin: false,
    name: account.name,
    email: null,
    plan: { name: 'free' },
  };
}

/** `POST /login/oauth/access_token`. */
function tokenRoute(state: State) {
  return http.post(`${GITHUB}/login/oauth/access_token`, async ({ request }) => {
    return state.answer.token?.() ?? exchange(state, new URLSearchParams(await request.text()));
  });
}

/** `GET /user` and `GET /user/emails`, for the owner of the bearer token. */
function identityRoutes(state: State) {
  return [
    http.get(`${API}/user`, ({ request }) => {
      const account = bearerAccount(state, request);
      return state.answer.user?.() ?? (account === undefined ? badCredentials() : HttpResponse.json(userBody(account)));
    }),
    http.get(`${API}/user/emails`, ({ request }) => {
      const account = bearerAccount(state, request);
      return (
        state.answer.emails?.() ??
        (account === undefined
          ? badCredentials()
          : HttpResponse.json(account.emails.map((entry) => ({ ...entry, visibility: 'private' }))))
      );
    }),
  ];
}

/** `DELETE /applications/{client_id}/token`: Basic authentication with the client credentials, the token in the body. */
function revokeRoute(state: State) {
  return http.delete(`${API}/applications/${encodeURIComponent(TEST_CLIENT_ID)}/token`, async ({ request }) => {
    const override = state.answer.revoke?.();
    if (override !== undefined) {
      return override;
    }
    if (request.headers.get('authorization') !== BASIC) {
      return badCredentials();
    }
    const body = z.object({ access_token: z.string() }).parse(JSON.parse(await request.text()));
    state.revoked.push(body.access_token);
    return new HttpResponse(null, { status: 204 });
  });
}

/** Starts the mocked GitHub until the test ends; every request is noted in `state.requests`. */
function serve(state: State): void {
  const server = setupServer(
    http.all('*', async ({ request }) => {
      const body = await request.clone().text();
      state.requests.push({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        body,
      });
      return undefined;
    }),
    tokenRoute(state),
    ...identityRoutes(state),
    revokeRoute(state),
  );
  server.listen({ onUnhandledFrame: 'error' });
  onTestFinished(() => {
    server.close();
  });
}

/** Starts a mocked GitHub; it answers until the test ends. */
export function fakeGithub(account: FakeAccount = ALICE): FakeGithub {
  const state: State = {
    account,
    answer: {},
    requests: [],
    revoked: [],
    issued: [],
    grants: new Map(),
    tokens: new Map(),
  };
  serve(state);
  return {
    get account() {
      return state.account;
    },
    set account(next) {
      state.account = next;
    },
    answer: state.answer,
    requests: state.requests,
    revoked: state.revoked,
    issued: state.issued,
    grant: (authorizeUrl) => {
      const url = new URL(authorizeUrl);
      const code = `code-made-up-${state.grants.size + 1}`;
      state.grants.set(code, {
        account: state.account,
        clientId: String(url.searchParams.get('client_id')),
        redirectUri: String(url.searchParams.get('redirect_uri')),
        challenge: String(url.searchParams.get('code_challenge')),
        used: false,
      });
      return code;
    },
  };
}

/** A login the browser started: what GitHub's page was told, and the cookie the browser holds. */
interface StartedLogin {
  /** The authorize URL the browser was sent to. */
  readonly location: string;
  /** The `state` in it. */
  readonly state: string;
  readonly sent: SentAttempt;
  /** What the browser sends back: `__Host-cla_oauth=<signed value>`. */
  readonly cookie: string;
}

/** What a test says about one callback; every field is a parameter of the callback request. */
interface CallbackInput {
  readonly query: Readonly<Record<string, string | string[]>>;
  /** The `Cookie` header, or none. */
  readonly cookie?: string | undefined;
}

export interface CallbackWorld extends AuthWorld {
  readonly github: FakeGithub;
  /** The browser, logged out, opens `/api/auth/login`. */
  readonly start: (returnTo?: string) => Promise<StartedLogin>;
  /** The browser comes back from GitHub. */
  readonly callback: (input: CallbackInput) => Promise<LightMyRequestResponse>;
  /** The whole login of a person who clicks "Authorize": start, grant, callback. `session` is a session cookie the browser holds. */
  readonly signIn: (parts?: { readonly returnTo?: string; readonly session?: string }) => Promise<SignedIn>;
}

interface SignedIn {
  readonly started: StartedLogin;
  readonly code: string;
  readonly response: LightMyRequestResponse;
}

/** The `Set-Cookie` headers of a response, whatever their number. */
export function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers['set-cookie'];
  if (header === undefined) {
    return [];
  }
  return Array.isArray(header) ? header : [header];
}

/** The `Cookie` header a browser sends from the cookies it holds. */
const cookieHeader = (...cookies: (string | undefined)[]): string =>
  cookies.filter((cookie) => cookie !== undefined).join('; ');

/** The real app over a migrated PGlite, a mocked GitHub, and the means to run the login between them. */
export async function callbackWorld(
  env: Readonly<Record<string, string>> = {},
  options: { readonly githubTimeoutMs?: number } = {},
): Promise<CallbackWorld> {
  const github = fakeGithub();
  const world = await authWorld({ PUBLIC_BASE_URL: 'https://app.example.com', ...env }, options);
  const start = async (returnTo?: string): Promise<StartedLogin> => {
    const response = await world.app.inject({
      url: '/api/auth/login',
      ...(returnTo === undefined ? {} : { query: { return_to: returnTo } }),
    });
    const location = String(response.headers.location);
    const sent = sentAttempt(response.headers['set-cookie']);
    return { location, state: String(new URL(location).searchParams.get('state')), sent, cookie: sent.cookie };
  };
  const callback = (input: CallbackInput) =>
    world.app.inject({
      url: '/api/auth/callback',
      query: { ...input.query },
      ...(input.cookie === undefined ? {} : { headers: { cookie: input.cookie } }),
    });
  return {
    ...world,
    github,
    start,
    callback,
    signIn: async (parts = {}) => {
      const started = await start(parts.returnTo);
      const code = github.grant(started.location);
      const response = await callback({
        query: { code, state: started.state },
        cookie: cookieHeader(started.cookie, parts.session),
      });
      return { started, code, response };
    },
  };
}
