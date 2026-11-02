// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { GitHubAuthError, GitHubResponseError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { type AppResponse, appSchema } from './schemas.ts';

/**
 * github.com only: GitHub Enterprise Server is out of scope (E05).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const GITHUB_API_ORIGIN = 'https://api.github.com';

const ROUTE = 'GET /app';

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

async function send(request: typeof fetch, jwt: string, timeoutMs: number): Promise<Response> {
  try {
    return await request(`${GITHUB_API_ORIGIN}/app`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'User-Agent': 'cla-gate',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // The token must go to api.github.com and nowhere else.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw unreachable(error);
  }
}

async function readJson(response: Response): Promise<unknown> {
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
    // The parser's message can quote the text; the body stays out of the error.
    throw new GitHubResponseError(ROUTE, []);
  }
}

/**
 * `GET /app` with a JWT (E05-S02): the App the token belongs to.
 * @throws GitHubAuthError on 401, GitHubUnavailableError for a network failure, a timeout or any other status, and
 * GitHubResponseError for a body that is not what {@link appSchema} says. None of them carries the JWT or the body.
 */
export async function fetchApp(request: typeof fetch, jwt: string, timeoutMs: number): Promise<AppResponse> {
  const response = await send(request, jwt, timeoutMs);
  if (response.status === 401) {
    await response.body?.cancel();
    throw new GitHubAuthError();
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new GitHubUnavailableError(`GitHub answered ${response.status} to ${ROUTE}`);
  }
  const parsed = appSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(body)');
    throw new GitHubResponseError(ROUTE, [...new Set(paths)]);
  }
  return parsed.data;
}
