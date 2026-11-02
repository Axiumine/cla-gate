// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { GitHubAuthError } from '../../services/ports/github-errors.ts';
import { apiHeaders } from './api-headers.ts';
import type { RequestHeaders } from './octokit-request.ts';

// Who a request of the Octokit adapter is made as (E05-S04).

/** Runs a request as the App with a JWT. `GitHubApp.withJwt` verifies the App first and walks the signing keys on a 401. */
export type WithJwt = <T>(send: (jwt: string) => Promise<T>) => Promise<T>;

/** The installation tokens (E05-S03), narrowed to what the client uses. */
export interface Tokens {
  get(githubInstallationId: GithubId): Promise<{ readonly token: { reveal(): string } }>;
  invalidate(githubInstallationId: GithubId): void;
}

/** The headers of one request: the shared ones and the credential. */
function headersFor(credential: string): RequestHeaders {
  return { ...apiHeaders(), authorization: `Bearer ${credential}` };
}

/** Runs `send` signed as the App. */
export function asApp<T>(withJwt: WithJwt, send: (headers: RequestHeaders) => Promise<T>): Promise<T> {
  return withJwt((jwt) => send(headersFor(jwt)));
}

/**
 * Runs `send` with the installation's token. A 401 means the cached token was revoked or expired early: it is dropped
 * and the request is repeated once with a new one (E05-S03); a second 401 is the caller's {@link GitHubAuthError}.
 * @throws whatever the token provider throws (InstallationNotAdmittedError, InstallationGoneError, ...) before any request.
 */
export async function asInstallation<T>(
  tokens: Tokens,
  githubInstallationId: GithubId,
  send: (headers: RequestHeaders) => Promise<T>,
): Promise<T> {
  const first = await tokens.get(githubInstallationId);
  try {
    return await send(headersFor(first.token.reveal()));
  } catch (error) {
    if (!(error instanceof GitHubAuthError)) {
      throw error;
    }
  }
  tokens.invalidate(githubInstallationId);
  const fresh = await tokens.get(githubInstallationId);
  return send(headersFor(fresh.token.reveal()));
}
