// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Route } from '../../shared/contract.ts';
import { ApiError } from './errors.ts';
import { changesState, type LooseInput, prepareRequest, requestHeaders } from './request.ts';
import { guarded, readError, readSuccess } from './response.ts';

// One call from request to answer (E17-S04): the request, the answer read as a value or an error, and the one retry that
// the CSRF token earns. The retry is the only automatic one the client has.

/** The `fetch` the client uses: the browser's (`window.fetch.bind(window)`), or a fake in a test. */
export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

/** Where the CSRF token comes from: the session query of E17-S08, which holds it in memory only. */
export interface CsrfSource {
  /** The token of the session held now, or `undefined` when there is none (yet). */
  readonly current: () => string | undefined;
  /** Loads the session again and returns its token, `undefined` when there is no session any more. */
  readonly refresh: () => Promise<string | undefined>;
}

/** What the client was built from, with the clock defaulted. */
export interface Parts {
  readonly fetch: FetchFunction;
  readonly csrf: CsrfSource;
  /** The clock a `Retry-After` date counts from, in milliseconds. */
  readonly now: () => number;
}

/** What one call works with: the route, the input as the caller gave it, and the signal that aborts it. */
export interface Exchange {
  readonly route: Route;
  readonly input: LooseInput;
  readonly signal: AbortSignal | undefined;
}

const CSRF_REJECTED = 'csrf_invalid';
const FORBIDDEN = 403;

/** Whether the server refused a request for its CSRF token (and so did nothing with it). */
function isCsrfRejection(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === FORBIDDEN && error.code === CSRF_REJECTED;
}

/** One request and its answer: the parsed success body, or the error the answer is. */
async function run({ fetch, now }: Parts, { route, input, signal }: Exchange, token: string | undefined) {
  const prepared = prepareRequest(route, input);
  const init: RequestInit = {
    method: route.method,
    credentials: 'same-origin',
    headers: requestHeaders(route, prepared, token),
    ...(prepared.body === undefined ? {} : { body: prepared.body }),
    ...(signal === undefined ? {} : { signal }),
  };
  const response = await guarded(fetch(prepared.url, init), signal);
  if (response.ok) {
    return readSuccess(route, response, signal);
  }
  throw await readError(response, now(), signal);
}

/**
 * The call, with one refresh and one retry when the server refused the CSRF token of a request that changes state: the
 * session may have been renewed (or the page loaded before it began). A second refusal is the answer.
 */
export async function execute(parts: Parts, exchange: Exchange) {
  try {
    return await run(parts, exchange, parts.csrf.current());
  } catch (error) {
    if (!isCsrfRejection(error) || !changesState(exchange.route.method)) {
      throw error;
    }
    const fresh = await parts.csrf.refresh();
    if (fresh === undefined) {
      throw error;
    }
    return run(parts, exchange, fresh);
  }
}
