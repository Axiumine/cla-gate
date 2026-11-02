// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Clock } from '../../services/ports/clock.ts';
import { GitHubAuthError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { readJson, schemaFailure, sendAsApp } from './github-http.ts';
import { rateLimitFrom, signalsOfResponse } from './rate-limit-reading.ts';
import { type AppResponse, appSchema } from './schemas.ts';

/** The route template: names the call in errors and in the rate limiter. */
export const APP_ROUTE = 'GET /app';
const ROUTE = APP_ROUTE;

/**
 * `GET /app` with a JWT (E05-S02): the App the token belongs to.
 * @throws GitHubAuthError on 401, GitHubRateLimitedError on a 429 or a 403 that is a rate limit,
 * GitHubUnavailableError for a network failure, a timeout or any other status, and GitHubResponseError for a body that
 * is not what {@link appSchema} says. None of them carries the JWT or the body.
 */
export async function fetchApp(
  request: typeof fetch,
  jwt: string,
  timeoutMs: number,
  clock: Clock,
): Promise<AppResponse> {
  const response = await sendAsApp(request, { method: 'GET', path: '/app', jwt, timeoutMs });
  if (response.status === 401) {
    await response.body?.cancel();
    throw new GitHubAuthError();
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw (
      rateLimitFrom(signalsOfResponse(response, ''), clock.now().getTime()) ??
      new GitHubUnavailableError(`GitHub answered ${response.status} to ${ROUTE}`)
    );
  }
  const parsed = appSchema.safeParse(await readJson(response, ROUTE));
  if (!parsed.success) {
    throw schemaFailure(ROUTE, parsed.error);
  }
  return parsed.data;
}
