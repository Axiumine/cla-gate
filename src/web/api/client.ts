// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CallInput, Route, SuccessOf } from '../../shared/contract.ts';
import { ApiError } from './errors.ts';
import { type CsrfSource, execute, type FetchFunction, type Parts } from './exchange.ts';
import type { LooseInput } from './request.ts';
import { UNAUTHENTICATED_STATUS } from './response.ts';

// The typed API client (E17-S04). It sends what E10 requires and nothing else: the session cookie travels by itself
// (`credentials: same-origin`), the CSRF token comes from the session query and is read for each request, never copied
// or stored, and no `Authorization` header exists. It retries nothing by itself except the one request that the server
// refused for its CSRF token, which the server rejected before it did anything.

export interface ApiClientOptions {
  readonly fetch: FetchFunction;
  readonly csrf: CsrfSource;
  /** The clock a `Retry-After` date counts from, in milliseconds; `Date.now` unless a test says otherwise. */
  readonly now?: () => number;
}

export interface CallOptions {
  /** Aborts the call: it rejects with the abort error the browser raised, not a wrapper. */
  readonly signal?: AbortSignal | undefined;
}

/** The arguments after the route: the input is optional exactly when every part of it is optional. */
type CallArguments<R extends Route> =
  Partial<CallInput<R>> extends CallInput<R>
    ? [input?: CallInput<R>, options?: CallOptions]
    : [input: CallInput<R>, options?: CallOptions];

export interface ApiClient {
  /** Calls a route with the input its schemas accept. Resolves to the parsed success body; rejects with an {@link ApiError}, `ContractError`, `NetworkError` or the abort error. */
  readonly call: <R extends Route>(route: R, ...args: CallArguments<R>) => Promise<SuccessOf<R>>;
  /** Registers a callback for every call that ends in `unauthenticated` (a 401), with the name of the route. Returns the function that removes it. */
  readonly onUnauthenticated: (listener: (routeName: string) => void) => () => void;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const parts: Parts = { fetch: options.fetch, csrf: options.csrf, now: options.now ?? Date.now };
  const listeners = new Set<(routeName: string) => void>();

  // The overload is what callers see: typed from the route. The implementation below it works on the erased types; the body
  // it returns was parsed with the schema the route declares for its status, which is what `SuccessOf` says it is.
  function call<R extends Route>(route: R, ...args: CallArguments<R>): Promise<SuccessOf<R>>;
  async function call(route: Route, input: LooseInput = {}, callOptions: CallOptions = {}): Promise<unknown> {
    try {
      return await execute(parts, { route, input, signal: callOptions.signal });
    } catch (error) {
      if (error instanceof ApiError && error.status === UNAUTHENTICATED_STATUS) {
        for (const listener of listeners) {
          listener(route.name);
        }
      }
      throw error;
    }
  }

  return {
    call,
    onUnauthenticated(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
