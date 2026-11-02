// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type UseQueryResult, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { ApiClient } from '../api/index.ts';
import { type AuthState, authFor } from './auth.ts';
import { type Session, sessionQueryOptions } from './session.ts';

// What a component reads of the auth layer (E17-S08).

/** The API client of this app: the one every call goes through, so each carries the session cookie and the CSRF token. */
export function useApiClient(): ApiClient {
  return authFor(useQueryClient()).client;
}

/** What the auth layer says besides the session; a component that reads it renders again when it changes. */
export function useAuthState(): AuthState {
  const auth = authFor(useQueryClient());
  return useSyncExternalStore(auth.subscribe, auth.getState);
}

/**
 * Who is logged in: `{ authenticated: false }`, or the user with the CSRF token of the session. It asks the server through
 * the typed client and holds the answer in the query cache only, fresh for 60 seconds and asked again when the window gets
 * focus. Reading the auth state is what makes it observe the new session after the cache was cleared by a logout or an
 * ended session; without it the component would keep looking at a query that no longer exists.
 */
export function useSession(): UseQueryResult<Session> {
  useAuthState();
  return useQuery(sessionQueryOptions(useApiClient()));
}
