// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { z } from 'zod';
import { defineRoute } from '../../shared/contract.ts';
import { server } from '../test-support/server.ts';
import { type ApiClient, createApiClient } from './client.ts';
import { ApiError, NetworkError } from './errors.ts';
import type { CsrfSource, FetchFunction } from './exchange.ts';

// Shared by the tests of the API client (E17-S04): two made-up routes, a CSRF source that counts, a client whose `fetch`
// remembers what it was given, and a helper that answers a path with a fixed response and remembers each request.

const thingSchema = z.object({ id: z.string(), size: z.number() });

/** `GET /api/things/:thingId?limit=&tag=`: a route with a path parameter and a query. */
export const getThing = defineRoute({
  method: 'GET',
  path: '/api/things/:thingId',
  params: z.object({ thingId: z.string() }),
  query: z.object({ limit: z.number().optional(), tag: z.array(z.string()).optional(), flag: z.boolean().optional() }),
  responses: { 200: thingSchema },
});

/** `POST /api/things`: a route with a body. */
export const createThing = defineRoute({
  method: 'POST',
  path: '/api/things',
  body: z.object({ size: z.number().max(1000) }),
  responses: { 201: thingSchema },
});

/** `POST /api/things/reset`: a route with nothing to send and nothing back. */
export const resetThings = defineRoute({
  method: 'POST',
  path: '/api/things/reset',
  responses: { 204: z.undefined() },
});

/** `GET /api/things`: a route with nothing to send. */
export const listThings = defineRoute({
  method: 'GET',
  path: '/api/things',
  responses: { 200: z.array(thingSchema) },
});

export const THING = { id: 'abc', size: 3 };

export interface FakeCsrf extends CsrfSource {
  /** How many times the session was loaded again. */
  readonly refreshes: () => number;
  /** Changes the token that `current` returns. */
  readonly set: (token: string | undefined) => void;
}

/** A CSRF source that holds `token`, becomes `afterRefresh` (itself when none is given, even `undefined`) when refreshed, and counts the refreshes. */
export function fakeCsrf(token: string | undefined, ...afterRefresh: [string | undefined] | []): FakeCsrf {
  let held = token;
  let refreshed = 0;
  return {
    current: () => held,
    refresh: () => {
      refreshed += 1;
      held = afterRefresh.length === 0 ? token : afterRefresh[0];
      return Promise.resolve(held);
    },
    refreshes: () => refreshed,
    set: (next) => {
      held = next;
    },
  };
}

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

export interface TestClient {
  readonly client: ApiClient;
  /** Every `fetch` the client made, in order. */
  readonly sent: Recorded[];
}

/** A client over the real `fetch` (which MSW answers) that remembers each call. */
export function testClient(csrf: CsrfSource = fakeCsrf('csrf-token'), now?: () => number): TestClient {
  const sent: Recorded[] = [];
  const recording: FetchFunction = (url, init) => {
    sent.push({ url, init });
    return fetch(url, init);
  };
  return { client: createApiClient({ fetch: recording, csrf, ...(now === undefined ? {} : { now }) }), sent };
}

/** What a handler saw of one request. */
export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly text: string;
}

/** Answers the requests to `path` (any method) with `responses` in turn, the last one again for any further request, and records each. */
export function answer(path: string, ...responses: Response[]): Seen[] {
  const seen: Seen[] = [];
  server.use(
    http.all(path, async ({ request }) => {
      seen.push({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers),
        text: await request.text(),
      });
      const next = responses[Math.min(seen.length, responses.length) - 1];
      return next?.clone() ?? HttpResponse.error();
    }),
  );
  return seen;
}

/** A JSON response. */
export function json(body: JsonBodyType, status = 200, headers: Record<string, string> = {}): Response {
  return HttpResponse.json(body, { status, headers });
}

/** The standard error body of the server, with the `details` object of a domain error when the test gives one. */
export function envelope(
  status: number,
  code: string,
  headers: Record<string, string> = {},
  details?: Record<string, JsonBodyType>,
): Response {
  const error = { code, message: 'Standard text', requestId: 'req-00000001' };
  return json({ error: details === undefined ? error : { ...error, details } }, status, headers);
}

/** The error `work` throws, or `undefined` when it does not throw. */
export function thrown(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** What `work` rejects with (`undefined` when it resolves), so a test can look at the error itself. */
export async function rejection(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/** `value` as an {@link ApiError}, or a failure of the test when it is anything else. */
export function asApiError(value: unknown): ApiError {
  if (!(value instanceof ApiError)) {
    throw new Error('expected an ApiError');
  }
  return value;
}

/** `value` as a {@link NetworkError}, or a failure of the test when it is anything else. */
export function asNetworkError(value: unknown): NetworkError {
  if (!(value instanceof NetworkError)) {
    throw new Error('expected a NetworkError');
  }
  return value;
}
