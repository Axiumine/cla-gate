// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Clock } from '../../services/ports/clock.ts';
import {
  GitHubAuthError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationSuspendedError,
} from '../../services/ports/github-errors.ts';
import { readJson, schemaFailure, sendAsApp } from './github-http.ts';
import { rateLimitFrom, signalsOfResponse } from './rate-limit-reading.ts';
import { type InstallationTokenResponse, installationTokenSchema } from './schemas.ts';

/** The route template: names the call in errors and in the rate limiter, which counts a POST as a write. */
export const MINT_ROUTE = 'POST /app/installations/{installation_id}/access_tokens';
const ROUTE = MINT_ROUTE;

/** The one field of an error body that tells a suspension from any other refusal. */
const refusalSchema = z.object({ message: z.string() });

/** GitHub's wording is "This installation has been suspended". */
const SUSPENDED = /suspended/i;

/** The message of an error body, or undefined for a body that is not JSON or has no text message. */
async function messageOf(response: Response): Promise<string | undefined> {
  const body = await readJson(response, ROUTE).catch((error: unknown) => {
    if (error instanceof GitHubUnavailableError) {
      throw error;
    }
    return undefined;
  });
  const refusal = refusalSchema.safeParse(body);
  return refusal.success ? refusal.data.message : undefined;
}

/**
 * A 429, or a 403: a suspension, a rate limit (which the limiter waits out or hands to the job layer) or any other
 * refusal. A 403 reads its body to tell them apart; the body never reaches the error.
 */
async function refused(response: Response, githubInstallationId: GithubId, clock: Clock): Promise<Error> {
  let message: string | undefined;
  if (response.status === 403) {
    message = await messageOf(response);
  } else {
    await response.body?.cancel();
  }
  if (message !== undefined && SUSPENDED.test(message)) {
    return new InstallationSuspendedError(githubInstallationId);
  }
  return (
    rateLimitFrom(signalsOfResponse(response, message ?? ''), clock.now().getTime()) ??
    new GitHubUnavailableError(`GitHub answered ${response.status} to ${ROUTE}`)
  );
}

/**
 * Mints an installation access token (E05-S03): `POST /app/installations/{id}/access_tokens` with the App JWT and no
 * body, so the token carries the installation's full permissions. Nothing is retried here: the rate limiter
 * (`rate-limiter.ts`, E05-S05) runs this call as a write in the installation's lane and repeats it after a short limit,
 * and the adapter of E05-S04 retries idempotent GETs only.
 * @throws GitHubAuthError on 401, InstallationGoneError on 404, InstallationSuspendedError on a 403 that says
 * suspended, GitHubRateLimitedError on a 429 or a 403 that is a rate limit, GitHubUnavailableError for a network
 * failure, a timeout or any other status, GitHubResponseError for a body that is not what
 * {@link installationTokenSchema} says. None of them carries the JWT, the token or the body.
 */
export async function mintInstallationToken(
  request: typeof fetch,
  jwt: string,
  githubInstallationId: GithubId,
  { timeoutMs, clock }: { readonly timeoutMs: number; readonly clock: Clock },
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
  if (response.status === 403 || response.status === 429) {
    throw await refused(response, githubInstallationId, clock);
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
