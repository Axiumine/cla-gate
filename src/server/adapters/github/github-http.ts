// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ZodError } from 'zod';
import { GitHubResponseError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';

// The part of talking to api.github.com that every App-authenticated call shares (E05-S02, E05-S03): one place that
// sets the headers, refuses redirects, applies the timeout and turns a broken connection into an outage. Until the
// Octokit adapter of E05-S04 replaces the transport, `GET /app` and the token mint both go through here.

/**
 * github.com only: GitHub Enterprise Server is out of scope (E05).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const GITHUB_API_ORIGIN = 'https://api.github.com';

/** What a failed attempt is called in a message: the system error code (`ECONNREFUSED`), else the error's class. */
function failureName(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') {
    return cause.code;
  }
  return error instanceof Error ? error.name : 'unknown error';
}

/** The request never produced an answer (or the answer broke off): an outage, not a verdict. The cause is dropped. */
function unreachable(error: unknown): GitHubUnavailableError {
  return new GitHubUnavailableError(`GitHub could not be reached (${failureName(error)})`);
}

export interface AppRequest {
  readonly method: 'GET' | 'POST';
  /** Starts with `/`; built from fixed text and numeric ids only. */
  readonly path: string;
  /** The App JWT, sent as the bearer token. */
  readonly jwt: string;
  readonly timeoutMs: number;
}

/**
 * Sends a request authenticated as the App, with no body. A redirect is an error, because the token must go to
 * api.github.com and nowhere else.
 * @throws GitHubUnavailableError when no answer comes (network failure, timeout, redirect).
 */
export async function sendAsApp(
  request: typeof fetch,
  { method, path, jwt, timeoutMs }: AppRequest,
): Promise<Response> {
  try {
    return await request(`${GITHUB_API_ORIGIN}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'User-Agent': 'cla-gate',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw unreachable(error);
  }
}

/**
 * The JSON body of an answer, as `unknown`.
 * @throws GitHubUnavailableError when the body breaks off while it is read, GitHubResponseError (no paths) when it is
 * not JSON. The parser's message can quote the text, so the body stays out of the error.
 */
export async function readJson(response: Response, route: string): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw unreachable(error);
  }
  try {
    const body: unknown = JSON.parse(text);
    return body;
  } catch {
    throw new GitHubResponseError(route, []);
  }
}

/** A body that is not what the route's schema says: the route and where it failed, never the body. */
export function schemaFailure(route: string, error: ZodError): GitHubResponseError {
  const paths = error.issues.map((issue) => issue.path.map(String).join('.') || '(body)');
  return new GitHubResponseError(route, [...new Set(paths)]);
}
