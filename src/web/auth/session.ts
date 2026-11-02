// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { sessionResponseSchema } from '../../shared/auth.ts';
import { sessionRoute } from '../../shared/auth-contract.ts';
import { type ApiClient, ApiError } from '../api/index.ts';

// The session as the screens see it (E17-S08): who is logged in and the CSRF token of that session, or nobody. It lives in
// the query cache and nowhere else: not in a store, not in Web Storage, not in a cookie the page can read.

/** The one origin an avatar may come from; the Content-Security-Policy accepts images from it and from this site (E17-S03). */
const AVATAR_ORIGIN = 'https://avatars.githubusercontent.com';

/** Whether `value` is an address on GitHub's avatar host over HTTPS, without credentials (they would not change the origin). */
function isAvatarUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return url.origin === AVATAR_ORIGIN && url.username === '' && url.password === '';
}

/**
 * The avatar address the page may load: only an address on GitHub's avatar host over HTTPS passes, and anything else, a
 * look-alike host and a `javascript:` address included, becomes `null`, which the avatar shows as initials.
 */
export const avatarUrlSchema = z.string().refine(isAvatarUrl).nullable().catch(null);

/** The caller, as the session endpoint describes them: display snapshots, and the numeric GitHub id as the identity. */
export interface SessionUser {
  readonly githubId: number;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

/** What `useSession()` holds: nobody, or the user with the CSRF token of the session and when the session ends. */
export type Session =
  | { readonly authenticated: false }
  | {
      readonly authenticated: true;
      readonly user: SessionUser;
      /** The token the client sends in `x-csrf-token` on every call that changes state; it is read from here for each request. */
      readonly csrfToken: string;
      /** When the session ends unless it is used again, ISO 8601. */
      readonly expiresAt: string;
    };

/** Nobody is logged in. */
export const ANONYMOUS: Session = { authenticated: false };

/** The key of the session query: the one entry of the cache that a logout or an ended session rewrites. */
export const SESSION_KEY = ['auth', 'session'] as const;

/** The session is fresh for a minute; after that, coming back to the window asks the server again. */
const SESSION_STALE_TIME_MS = 60_000;

const UNAUTHENTICATED = 401;

/** The session of a 200 answer; its avatar address is kept only when it passed {@link avatarUrlSchema}. */
function sessionOf(body: z.output<typeof sessionResponseSchema>): Session {
  return {
    authenticated: true,
    user: {
      githubId: body.user.githubId,
      login: body.user.login,
      name: body.user.name,
      avatarUrl: avatarUrlSchema.parse(body.user.avatarUrl),
    },
    csrfToken: body.csrfToken,
    expiresAt: body.expiresAt,
  };
}

/** Asks the server who is logged in. A 401 is the answer "nobody", not a failure; anything else that goes wrong is thrown. */
async function fetchSession(client: ApiClient, signal: AbortSignal): Promise<Session> {
  try {
    return sessionOf(await client.call(sessionRoute, undefined, { signal }));
  } catch (error) {
    if (error instanceof ApiError && error.status === UNAUTHENTICATED) {
      return ANONYMOUS;
    }
    throw error;
  }
}

/** The session query: fresh for a minute, and asked again when the window gets focus after that. */
export function sessionQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: SESSION_KEY,
    queryFn: ({ signal }) => fetchSession(client, signal),
    staleTime: SESSION_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
}
