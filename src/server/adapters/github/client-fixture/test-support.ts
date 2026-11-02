// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { onTestFinished } from 'vitest';
import type { GithubId } from '../../../../shared/github-id.ts';
import { Secret } from '../../../config/secret.ts';
import { FakeClock } from '../../../services/test-support.ts';
import { captureLogs, type LogCapture } from '../../../test-support.ts';
import { createLogger } from '../../http/logger.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';
import { OctokitGitHubClient } from '../octokit-client.ts';
import { createOctokit } from '../octokit-transport.ts';
import { RateLimiter } from '../rate-limiter.ts';
import { START } from '../test-support.ts';

// The Octokit adapter alone, for the tests that look at what it sends and how it reads failures (E05-S04, E05-S05): MSW
// serves the routes a test names, the credentials are stand-ins (the signer and the token provider have their own tests),
// and the waits (between repeated attempts, for a rate limit) are recorded instead of slept: each one moves the fixture's
// clock forward by the time it stood for, so a limit that "lasts 2 s" is over when the wait returns.

/** What a mocked route was called with. */
export interface RouteCall {
  readonly method: string;
  /** The path, as sent (percent-encoding intact). */
  readonly path: string;
  /** The query string with its `?`, or an empty string. */
  readonly search: string;
  readonly headers: Headers;
}

/** How a mocked route answers. */
export type RouteAnswer = (call: RouteCall) => Response | Promise<Response>;

/** Answers by `"GET /path/:param"`; every other request to api.github.com is an error. */
export type Routes = Readonly<Record<string, RouteAnswer>>;

/** A request line as the tests spell it: `GET /repositories/101`, query included. */
export const line = (call: RouteCall): string => `${call.method} ${call.path}${call.search}`;

/** Serves `routes` until the test ends and returns the calls received, in order. Every route is a GET. */
export function serveRoutes(routes: Routes): RouteCall[] {
  const calls: RouteCall[] = [];
  const handlers = Object.entries(routes).map(([spec, answer]) =>
    http.get(`${GITHUB_API_ORIGIN}${spec.replace(/^GET /, '')}`, ({ request }) => {
      const url = new URL(request.url);
      const call: RouteCall = {
        method: request.method,
        path: url.pathname,
        search: url.search,
        headers: request.headers,
      };
      calls.push(call);
      return answer(call);
    }),
  );
  const server = setupServer(...handlers);
  server.listen({ onUnhandledFrame: 'error' });
  onTestFinished(() => {
    server.close();
  });
  return calls;
}

/** A JSON answer. */
export const json = (body: object | null, status = 200, headers: Record<string, string> = {}): Response =>
  HttpResponse.json(body, { status, headers });

/** The stand-in JWT every App-level request carries. */
export const MADE_UP_JWT = 'made-up-jwt';

export interface ClientFixtureOptions {
  /** In [0, 1): the jitter's share of 250 ms. Defaults to 0, so a wait is exactly 1000 or 2000. */
  readonly random?: () => number;
  readonly timeoutMs?: number;
  /** Replaces the wait: it gets the milliseconds, and the clock is moved forward when it returns. Defaults to returning at once. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Replaces the token provider's `get`. */
  readonly get?: (githubInstallationId: GithubId, issued: number) => Promise<{ readonly token: Secret }>;
}

export interface ClientFixture {
  readonly client: OctokitGitHubClient;
  readonly calls: RouteCall[];
  /** Every wait the adapter asked for (between attempts, for a rate limit), in milliseconds. */
  readonly waits: number[];
  /** The time of the adapter: it starts at {@link START} and moves by the waits. */
  readonly clock: FakeClock;
  /** The installation ids the token provider was asked to drop. */
  readonly invalidated: GithubId[];
  readonly logs: LogCapture;
}

/** The adapter, wired to MSW and to a token provider that numbers its tokens: `ghs_made-up-<installation>-<n>`. */
export function clientFixture(routes: Routes, options: ClientFixtureOptions = {}): ClientFixture {
  const calls = serveRoutes(routes);
  const waits: number[] = [];
  const invalidated: GithubId[] = [];
  const issued = new Map<GithubId, number>();
  const current = (githubInstallationId: GithubId): number => issued.get(githubInstallationId) ?? 1;
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  const clock = new FakeClock(START);
  const sleep = async (milliseconds: number): Promise<void> => {
    waits.push(milliseconds);
    await options.sleep?.(milliseconds);
    clock.advance(milliseconds);
  };
  const octokit = createOctokit({
    fetch,
    timeoutMs: options.timeoutMs ?? 5000,
    logger,
    sleep,
    random: options.random ?? (() => 0),
  });
  const client = new OctokitGitHubClient({
    octokit,
    limiter: new RateLimiter({ clock, logger, sleep }),
    withJwt: (send) => send(MADE_UP_JWT),
    tokens: {
      get: (githubInstallationId) => {
        const number = current(githubInstallationId);
        return (
          options.get?.(githubInstallationId, number) ??
          Promise.resolve({ token: new Secret(`ghs_made-up-${githubInstallationId}-${number}`) })
        );
      },
      invalidate: (githubInstallationId) => {
        invalidated.push(githubInstallationId);
        issued.set(githubInstallationId, current(githubInstallationId) + 1);
      },
    },
  });
  return { client, calls, waits, clock, invalidated, logs };
}

/** An installation as GitHub spells it, with fields the platform does not use. */
export function installationJson(githubId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: githubId,
    account: { id: githubId + 5000, login: 'acme', type: 'Organization', node_id: 'MDEyOk9yZ2FuaXphdGlvbg==' },
    app_id: 4242,
    suspended_at: null,
    permissions: { checks: 'write', metadata: 'read' },
    events: ['pull_request'],
    ...overrides,
  };
}

/** A repository as GitHub spells it, with fields the platform does not use. */
export function repositoryJson(githubId: number, fullName = 'acme/api'): Record<string, unknown> {
  return {
    id: githubId,
    name: fullName.split('/')[1],
    full_name: fullName,
    private: true,
    owner: { login: fullName.split('/')[0], id: 1, type: 'Organization' },
    default_branch: 'main',
  };
}

/** An organisation membership as GitHub spells it. */
export function membershipJson(userId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: 'https://api.github.com/orgs/acme/memberships/alice',
    state: 'active',
    role: 'member',
    organization_url: 'https://api.github.com/orgs/acme',
    user: { login: 'alice', id: userId },
    ...overrides,
  };
}
