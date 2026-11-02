// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type KeyObject, verify } from 'node:crypto';
import { HttpResponse, http, passthrough } from 'msw';
import { setupServer } from 'msw/node';
import { onTestFinished } from 'vitest';
import { z } from 'zod';
import { FakeClock } from '../../services/test-support.ts';
import { captureLogs, type LogCapture } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { GITHUB_API_ORIGIN } from './app-api.ts';
import { AppAuth, type KeyList } from './app-auth.ts';
import { AppIdentityCheck } from './app-identity.ts';

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

/**
 * Serves `GET https://api.github.com/app` until the test ends. A JWT signed by none of `accepts` (the public halves of
 * the keys registered on the App) is answered 401; any other is answered by `answer`, 200 with {@link appBody} unless it
 * says otherwise. Every other request is an error. Call it again for another answer; the last call wins.
 */
export function mockApp(
  accepts: readonly KeyObject[],
  answer: () => Response | Promise<Response> = () => HttpResponse.json(appBody()),
): AppRoute {
  const tokens: string[] = [];
  const headers: Headers[] = [];
  // The handlers stay inside this function: MSW's types contain `any`, which type-coverage would count in every test.
  const server = setupServer(
    http.get(`${GITHUB_API_ORIGIN}/app`, ({ request }) => {
      const token = BearerToken.parse(request.headers.get('authorization'));
      tokens.push(token);
      headers.push(request.headers);
      const signed = accepts.some((key) => jwtSignedBy(token, key));
      return signed
        ? answer()
        : HttpResponse.json({ message: 'A JSON web token could not be decoded' }, { status: 401 });
    }),
    http.all(LOOPBACK, () => passthrough()),
  );
  server.listen({ onUnhandledFrame: 'error' });
  onTestFinished(() => {
    server.close();
  });
  return { tokens, headers };
}

/** The moment every fixture starts at. */
export const START = '2026-11-02T10:00:00.000Z';

/** The App id of {@link appBody}. */
export const APP_ID = '4242';

/** An App signer and identity check wired to a fake clock and a log capture, talking to whatever MSW serves. */
export interface AppFixture {
  readonly auth: AppAuth;
  readonly check: AppIdentityCheck;
  readonly clock: FakeClock;
  readonly logs: LogCapture;
}

/** Call {@link mockApp} first: the fixture takes the global `fetch` as it is then. */
export function appFixture(keys: KeyList, timeoutMs = 5000): AppFixture {
  const clock = new FakeClock(START);
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  const auth = new AppAuth({ appId: APP_ID, keys, clock, logger });
  const check = new AppIdentityCheck({ auth, appId: APP_ID, logger, fetch, timeoutMs });
  return { auth, check, clock, logs };
}
