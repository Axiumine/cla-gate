// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueryClient } from '@tanstack/react-query';
import { type ApiClient, type CsrfSource, createApiClient } from '../api/index.ts';
import { ANONYMOUS, SESSION_KEY, type Session, sessionQueryOptions } from './session.ts';

// The auth layer of one query cache (E17-S08): the API client that sends what E10 requires, and what the page is told when
// the session ends. There is one per query client, made on first use, so the router (which has only the query client in
// its context) and the components reach the same client.

/** What the screens are told about the session besides the session itself. */
export interface AuthState {
  /** A call came back 401 while a session was held: the session ended and the banner says so. */
  readonly ended: boolean;
  /** Counts the times the cache was cleared. The queries that were observed before are gone; a component that reads this renders again, which makes it observe the new ones. */
  readonly epoch: number;
}

export interface Auth {
  readonly client: ApiClient;
  /** For `useSyncExternalStore`. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => AuthState;
  /** A logout succeeded: nothing of the session survives, and nobody is logged in. */
  readonly signedOut: () => void;
}

const registry = new WeakMap<QueryClient, Auth>();

/** The session held in the cache now, if any. */
function heldSession(queryClient: QueryClient): Session | undefined {
  return queryClient.getQueryData<Session>(SESSION_KEY);
}

interface Store {
  readonly subscribe: Auth['subscribe'];
  readonly getState: Auth['getState'];
  /** Ends the session the cache holds: `ended` says whether it ended on its own (a 401) or the person logged out. */
  readonly reset: (ended: boolean) => void;
}

/**
 * The state the screens read, and the one way to end a session. Everything the cache holds belongs to the session that is
 * over, so all of it goes, and the session itself becomes "nobody" at once: nothing waits for an answer to show the login
 * link. When the session ended on its own, that "nobody" is also marked out of date, so the next time the window gets focus
 * the server is asked whether someone logged in again meanwhile.
 */
function createStore(queryClient: QueryClient): Store {
  let state: AuthState = { ended: false, epoch: 0 };
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    reset: (ended) => {
      queryClient.clear();
      queryClient.setQueryData<Session>(SESSION_KEY, ANONYMOUS);
      if (ended) {
        void queryClient.invalidateQueries({ queryKey: SESSION_KEY, refetchType: 'none' });
      }
      state = { ended, epoch: state.epoch + 1 };
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/**
 * Where the client reads the CSRF token: from the session held in the cache, for each request. A rejected token is replaced
 * by asking the server again, once and without the query's retries because a call is waiting for the answer. `undefined`
 * means there is no session any more (or the server could not say), and the client then reports the first refusal.
 */
function csrfSource(queryClient: QueryClient, client: () => ApiClient): CsrfSource {
  return {
    current: () => {
      const session = heldSession(queryClient);
      return session?.authenticated === true ? session.csrfToken : undefined;
    },
    refresh: async () => {
      try {
        const session = await queryClient.query({ ...sessionQueryOptions(client()), staleTime: 0, retry: false });
        return session.authenticated ? session.csrfToken : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

function createAuth(queryClient: QueryClient): Auth {
  const store = createStore(queryClient);
  const client: ApiClient = createApiClient({
    fetch: (url, init) => window.fetch(url, init),
    csrf: csrfSource(queryClient, () => client),
  });
  // A 401 while a session is held means it ended (idle or absolute expiry, or its sessions were deleted). With nobody logged
  // in a 401 is the plain answer "log in first", and there is nothing to end.
  client.onUnauthenticated(() => {
    if (heldSession(queryClient)?.authenticated === true) {
      store.reset(true);
    }
  });
  return {
    client,
    subscribe: store.subscribe,
    getState: store.getState,
    signedOut: () => {
      store.reset(false);
    },
  };
}

/** The auth layer of `queryClient`. */
export function authFor(queryClient: QueryClient): Auth {
  const held = registry.get(queryClient);
  if (held !== undefined) {
    return held;
  }
  const created = createAuth(queryClient);
  registry.set(queryClient, created);
  return created;
}
