// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { GithubId } from '../../../shared/github-id.ts';
import {
  GitHubAuthError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationSuspendedError,
} from '../../services/ports/github-errors.ts';
import { readJson, schemaFailure, sendAsApp } from './github-http.ts';
import { type InstallationTokenResponse, installationTokenSchema } from './schemas.ts';

const ROUTE = 'POST /app/installations/{installation_id}/access_tokens';

/** The one field of an error body that tells a suspension from any other refusal. */
const refusalSchema = z.object({ message: z.string() });

/** GitHub's wording is "This installation has been suspended". */
const SUSPENDED = /suspended/i;

/** True when a 403 says the installation is suspended. A body that is not JSON, or has no message, says nothing. */
async function saysSuspended(response: Response): Promise<boolean> {
  const body = await readJson(response, ROUTE).catch((error: unknown) => {
    if (error instanceof GitHubUnavailableError) {
      throw error;
    }
    return undefined;
  });
  const refusal = refusalSchema.safeParse(body);
  return refusal.success && SUSPENDED.test(refusal.data.message);
}

/** A 403 reads its body to tell a suspension from any other refusal; the body never reaches the error. */
async function forbidden(response: Response, githubInstallationId: GithubId): Promise<Error> {
  return (await saysSuspended(response))
    ? new InstallationSuspendedError(githubInstallationId)
    : new GitHubUnavailableError(`GitHub answered 403 to ${ROUTE}`);
}

/**
 * Mints an installation access token (E05-S03): `POST /app/installations/{id}/access_tokens` with the App JWT and no
 * body, so the token carries the installation's full permissions. Nothing is retried here: the adapter of E05-S04
 * retries idempotent GETs only.
 * @throws GitHubAuthError on 401, InstallationGoneError on 404, InstallationSuspendedError on a 403 that says
 * suspended, GitHubUnavailableError for a network failure, a timeout or any other status, GitHubResponseError for a
 * body that is not what {@link installationTokenSchema} says. None of them carries the JWT, the token or the body.
 */
export async function mintInstallationToken(
  request: typeof fetch,
  jwt: string,
  githubInstallationId: GithubId,
  timeoutMs: number,
): Promise<InstallationTokenResponse> {
  const path = `/app/installations/${githubInstallationId}/access_tokens`;
  const response = await sendAsApp(request, { method: 'POST', path, jwt, timeoutMs });
  if (response.status === 401) {
    await response.body?.cancel();
    throw new GitHubAuthError();
  }
  if (response.status === 404) {
    await response.body?.cancel();
    throw new InstallationGoneError(githubInstallationId);
  }
  if (response.status === 403) {
    throw await forbidden(response, githubInstallationId);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new GitHubUnavailableError(`GitHub answered ${response.status} to ${ROUTE}`);
  }
  const parsed = installationTokenSchema.safeParse(await readJson(response, ROUTE));
  if (!parsed.success) {
    throw schemaFailure(ROUTE, parsed.error);
  }
  return parsed.data;
}
