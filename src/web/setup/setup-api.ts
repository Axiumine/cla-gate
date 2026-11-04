// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ApiClient, ApiError, createApiClient } from '../api/index.ts';

// How the setup page talks to the setup API (E19-S07). The calls that change state carry the CSRF token of the setup session,
// which the unlock answered with and the page holds in memory only (the auth layer's client has no session to take one from),
// and the 401 of the setup routes means something else than the client's generic reading of it.

/** The 401 status: the client reads every one as `unauthenticated`, whatever code the server sent. */
const UNAUTHORIZED = 401;

/** A client for the setup calls that change state: it sends `csrfToken` in `x-csrf-token` and keeps no other state. */
export function setupClient(csrfToken: string): ApiClient {
  return createApiClient({
    fetch: (url, init) => window.fetch(url, init),
    // The token belongs to a session the server holds in memory; a refused token is not renewed here, the person unlocks again.
    csrf: { current: () => csrfToken, refresh: () => Promise.resolve(undefined) },
  });
}

/**
 * Waits for `work`, and gives a 401 the code the setup route means by it: the API client reads every 401 as
 * `unauthenticated` ("log in again"), which is not what these routes say. The unlock answers 401 for a wrong token
 * (`invalid_setup_token`) and every other setup route for a session that is not alive (`setup_locked`); `unauthorized` is
 * that code. Any other failure passes through unchanged.
 */
export async function withSetupCode<Value>(work: Promise<Value>, unauthorized: string): Promise<Value> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError && error.status === UNAUTHORIZED) {
      throw new ApiError({
        status: error.status,
        code: unauthorized,
        requestId: error.requestId,
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    throw error;
  }
}
