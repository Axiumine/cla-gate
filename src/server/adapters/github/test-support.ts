// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type KeyObject, verify } from 'node:crypto';
import { HttpResponse, http, passthrough } from 'msw';
import { setupServer } from 'msw/node';
import type { Logger } from 'pino';
import { onTestFinished } from 'vitest';
import { z } from 'zod';
import type { TestGitHubKey } from '../../config/test-support.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { InstallationGate } from '../../services/ports/installation-gate.ts';
import { FakeClock, FakeGate } from '../../services/test-support.ts';
import { captureLogs, type LogCapture } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { AppAuth, type KeyList } from './app-auth.ts';
import { AppIdentityCheck } from './app-identity.ts';
import { GITHUB_API_ORIGIN } from './github-http.ts';
import { InstallationTokens } from './installation-tokens.ts';
import { RateLimiter } from './rate-limiter.ts';

// GitHub at the HTTP boundary, for tests (E05-S02): MSW answers what the code sends to api.github.com, so the real
// `fetch` runs and only the network is replaced. Every request nobody handles is an error, not a call to the real API.

/** A test that boots the server also calls it with `fetch`, on loopback; MSW sees every `fetch` of the process. */
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+\//;

/** A realistic `GET /app` answer, with fields the platform does not use so the schema has something to drop. */
export function appBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 4242,
    slug: 'cla-gate-test',
    node_id: 'A_kgDOMadeUp',
    client_id: 'Iv1.madeupclientid',
    name: 'CLA Gate Test',
    owner: { login: 'acme', id: 9001, type: 'Organization', site_admin: false },
    permissions: { checks: 'write', metadata: 'read', pull_requests: 'read' },
    events: ['pull_request'],
    installations_count: 3,
    ...overrides,
  };
}

const Segments = z.tuple([z.string(), z.string(), z.string()]);

/** The token of an `Authorization: Bearer <token>` header. */
const BearerToken = z.string().transform((header) => header.replace(/^Bearer /, ''));

/** A token taken apart: the header text as sent, the claims, and what was signed. */
export interface DecodedJwt {
  readonly header: string;
  readonly claims: Record<string, unknown>;
  readonly signingInput: string;
  readonly signature: Buffer;
}

export function decodeJwt(token: string): DecodedJwt {
  const [header, claims, signature] = Segments.parse(token.split('.'));
  const text = (segment: string): string => Buffer.from(segment, 'base64url').toString('utf8');
  return {
    header: text(header),
    claims: z.record(z.string(), z.unknown()).parse(JSON.parse(text(claims))),
    signingInput: `${header}.${claims}`,
    signature: Buffer.from(signature, 'base64url'),
  };
}

/** True when `token` carries a valid RS256 signature of `publicKey`: what GitHub does with the App's registered keys. */
export function jwtSignedBy(token: string, publicKey: KeyObject): boolean {
  const { signingInput, signature } = decodeJwt(token);
  return verify('sha256', Buffer.from(signingInput, 'utf8'), publicKey, signature);
}

/** What the mocked `GET /app` was called with. */
export interface AppRoute {
  /** Every JWT received, in order. */
  readonly tokens: string[];
  /** The headers of every request received, in order. */
  readonly headers: Headers[];
}

/** What a mocked `POST /app/installations/{id}/access_tokens` was called with (E05-S03). */
interface MintCall {
  /** The `{id}` of the path, as text. */
  readonly installationId: string;
  readonly jwt: string;
  readonly headers: Headers;
  readonly body: string;
}

/** What a mocked GitHub received. */
export interface GitHubRoutes {
  readonly app: AppRoute;
  /** Every token request received, in order. */
  readonly mints: MintCall[];
}

/** How a mocked token route answers a request. */
export type MintAnswer = (call: MintCall) => Response | Promise<Response>;

/** What the mocked GitHub answers; a route nobody gives an answer for is not served at all. */
export interface GitHubAnswers {
  readonly app?: (() => Response | Promise<Response>) | undefined;
  readonly mint?: MintAnswer | undefined;
  /** `GET /installation/repositories`, the first call made with an installation token; gets the `Authorization` header. */
  readonly use?: ((authorization: string | null) => Response) | undefined;
}

const REFUSED_JWT = { message: 'A JSON web token could not be decoded' };

/** The token route, when a test gives it an answer. The handler stays here: MSW's types contain `any` (see below). */
function mintHandlers(accepts: readonly KeyObject[], mint: MintAnswer | undefined, received: MintCall[]) {
  if (mint === undefined) {
    return [];
  }
  return [
    http.post(`${GITHUB_API_ORIGIN}/app/installations/:id/access_tokens`, async ({ request, params }) => {
      const jwt = BearerToken.parse(request.headers.get('authorization'));
      const call: MintCall = {
        installationId: z.string().parse(params['id']),
        jwt,
        headers: request.headers,
        body: await request.text(),
      };
      received.push(call);
      return accepts.some((key) => jwtSignedBy(jwt, key))
        ? mint(call)
        : HttpResponse.json(REFUSED_JWT, { status: 401 });
    }),
  ];
}

/**
 * Serves `https://api.github.com` until the test ends: `GET /app` (200 with {@link appBody} unless `answers.app` says
 * otherwise) and, when `answers.mint` is given, `POST /app/installations/{id}/access_tokens`. A JWT signed by none of
 * `accepts` (the public halves of the keys registered on the App) is answered 401 on both; any other is answered by the
 * given function. Every other request is an error. Call it again for another answer; the last call wins.
 */
export function mockGitHub(accepts: readonly KeyObject[], answers: GitHubAnswers = {}): GitHubRoutes {
  const app: AppRoute = { tokens: [], headers: [] };
  const mints: MintCall[] = [];
  const answerApp = answers.app ?? (() => HttpResponse.json(appBody()));
  const { mint, use } = answers;
  // The handlers stay inside this function: MSW's types contain `any`, which type-coverage would count in every test.
  const useHandlers =
    use === undefined
      ? []
      : [
          http.get(`${GITHUB_API_ORIGIN}/installation/repositories`, ({ request }) =>
            use(request.headers.get('authorization')),
          ),
        ];
  const server = setupServer(
    http.get(`${GITHUB_API_ORIGIN}/app`, ({ request }) => {
      const token = BearerToken.parse(request.headers.get('authorization'));
      app.tokens.push(token);
      app.headers.push(request.headers);
      return accepts.some((key) => jwtSignedBy(token, key))
        ? answerApp()
        : HttpResponse.json(REFUSED_JWT, { status: 401 });
    }),
    ...mintHandlers(accepts, mint, mints),
    ...useHandlers,
    http.all(LOOPBACK, () => passthrough()),
  );
  server.listen({ onUnhandledFrame: 'error' });
  onTestFinished(() => {
    server.close();
  });
  return { app, mints };
}

/** Serves `GET /app` only: {@link mockGitHub} without a token route. */
export function mockApp(accepts: readonly KeyObject[], answer?: () => Response | Promise<Response>): AppRoute {
  return mockGitHub(accepts, { app: answer }).app;
}

/** GitHub's date format: ISO 8601 in UTC without milliseconds, for example `2026-11-02T11:00:00Z`. */
const githubDate = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A realistic token answer, with fields the platform does not use so the schema has something to drop (E05-S03). */
export function tokenBody(
  token: string,
  expiresAt: Date,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    token,
    expires_at: githubDate(expiresAt),
    permissions: { checks: 'write', metadata: 'read', pull_requests: 'read' },
    repository_selection: 'all',
    ...overrides,
  };
}

/**
 * A token route that issues `ghs_made-up-<installation>-<n>` for the n-th request, valid for `lifetimeMs` after the
 * fake clock's now (an hour, like GitHub's).
 */
export function hourlyTokens(clock: Clock, lifetimeMs = 3_600_000): MintAnswer {
  let issued = 0;
  return (call) => {
    issued += 1;
    const expiresAt = new Date(clock.now().getTime() + lifetimeMs);
    return HttpResponse.json(tokenBody(`ghs_made-up-${call.installationId}-${issued}`, expiresAt), { status: 201 });
  };
}

/** The moment every fixture starts at. */
export const START = '2026-11-02T10:00:00.000Z';

/** The App id of {@link appBody}. */
export const APP_ID = '4242';

/**
 * A rate limiter on the fixture's clock whose waits are recorded and move the clock, not slept: a limit of 30 s costs a
 * test no time. Its log goes where the fixture's does.
 */
function fixtureLimiter(clock: FakeClock, logger: Logger): { limiter: RateLimiter; waits: number[] } {
  const waits: number[] = [];
  const limiter = new RateLimiter({
    clock,
    logger,
    sleep: (milliseconds) => {
      waits.push(milliseconds);
      clock.advance(milliseconds);
      return Promise.resolve();
    },
  });
  return { limiter, waits };
}

/** An App signer and identity check wired to a fake clock and a log capture, talking to whatever MSW serves. */
export interface AppFixture {
  readonly auth: AppAuth;
  readonly check: AppIdentityCheck;
  readonly clock: FakeClock;
  readonly logs: LogCapture;
  /** Every wait the rate limiter asked for, in milliseconds. */
  readonly waits: number[];
}

/** Call {@link mockApp} first: the fixture takes the global `fetch` as it is then. */
export function appFixture(keys: KeyList, timeoutMs = 5000): AppFixture {
  const clock = new FakeClock(START);
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  const auth = new AppAuth({ appId: APP_ID, keys, clock, logger });
  const { limiter, waits } = fixtureLimiter(clock, logger);
  const check = new AppIdentityCheck({ auth, appId: APP_ID, logger, fetch, timeoutMs, clock, limiter });
  return { auth, check, clock, logs, waits };
}

/** The installation token provider wired to a fake clock, a log capture and a gate that admits everyone (E05-S03). */
export interface TokensFixture {
  readonly tokens: InstallationTokens;
  readonly auth: AppAuth;
  readonly clock: FakeClock;
  readonly logs: LogCapture;
  readonly gate: FakeGate;
  /** Every wait the rate limiter asked for, in milliseconds. */
  readonly waits: number[];
}

/**
 * Call {@link mockGitHub} first: the fixture takes the global `fetch` as it is then. The provider signs with `keys`
 * through the signer alone, without the identity check, so a test that only needs tokens does not serve `GET /app`.
 */
export function tokensFixture(
  keys: KeyList,
  options: { clock?: FakeClock; gate?: InstallationGate | null; timeoutMs?: number } = {},
): TokensFixture {
  const clock = options.clock ?? new FakeClock(START);
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'debug' }, logs.destination);
  const auth = new AppAuth({ appId: APP_ID, keys, clock, logger });
  const gate = new FakeGate();
  const { limiter, waits } = fixtureLimiter(clock, logger);
  const tokens = new InstallationTokens({
    withJwt: (send) => auth.withJwt(send),
    clock,
    logger,
    fetch,
    timeoutMs: options.timeoutMs ?? 5000,
    limiter,
    // undefined: the fixture's own gate, which admits everyone; null: no gate wired at all.
    gate: options.gate === undefined ? gate : (options.gate ?? undefined),
  });
  return { tokens, auth, clock, logs, gate, waits };
}

/** {@link TokensFixture} plus what the mocked token route received. */
export interface TokensWorld extends TokensFixture {
  readonly mints: MintCall[];
}

/**
 * A GitHub that issues hour-long tokens (or whatever `answer` makes of the fake clock) to the App that signs with
 * `key`, and a provider wired to it. The shortest way to a test of the provider.
 */
export function tokenWorld(key: TestGitHubKey, answer: (clock: FakeClock) => MintAnswer = hourlyTokens): TokensWorld {
  const clock = new FakeClock(START);
  const { mints } = mockGitHub([key.publicKey], { mint: answer(clock) });
  return { ...tokensFixture([key.key], { clock }), mints };
}
