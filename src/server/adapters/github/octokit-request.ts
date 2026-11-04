// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Octokit } from 'octokit';
import type { z } from 'zod';
import type { Clock } from '../../services/ports/clock.ts';
import { GitHubForbiddenError, GitHubNotFoundError } from '../../services/ports/github-errors.ts';
import { schemaFailure } from './github-http.ts';
import { failureOf } from './octokit-errors.ts';
import type { Page } from './pagination.ts';

// What every request of the Octokit adapter shares (E05-S04): one request with its failure turned into the port's
// error, one answer read through its schema, and the two ways a missing thing is an answer instead of an error. Every
// request goes through a {@link Channel}, which is where the rate limits of E05-S05 apply.

/** Items per page of a paged route, the most GitHub gives. */
const PER_PAGE = 100;

/** The headers of one request: the shared ones and the credential. */
export type RequestHeaders = Readonly<Record<string, string>>;

/** One request of Octokit, as far as the adapter reads its answer. */
export type RawRequest = () => Promise<{ data: unknown; headers: { link?: string | number } }>;

/**
 * What a request is sent through: the Octokit instance, and the lane of the installation (or of the App) it counts in.
 * `send` runs the request in that lane and turns its failure into the port's error for `route`; a rate limit of 60 s or
 * less is waited out and the request repeated (`rate-limiter.ts`).
 */
export interface Channel {
  /** The requests of the adapter are made with `request`, which may carry the abort signal of a job (E07-S03). */
  readonly octokit: Pick<Octokit, 'request'>;
  send(route: string, request: RawRequest): Promise<Page>;
}

/** One attempt, its failure turned into the port's error for `route`. */
export async function sendOnce(route: string, request: RawRequest, clock: Clock): Promise<Page> {
  try {
    const { data, headers } = await request();
    return { data, link: typeof headers.link === 'string' ? headers.link : undefined };
  } catch (error) {
    throw failureOf(error, route, clock.now().getTime());
  }
}

/** `data` read through `schema`. @throws GitHubResponseError with the route and the paths that failed, never the data. */
export function parseOne<T>(route: string, schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw schemaFailure(route, parsed.error);
  }
  return parsed.data;
}

/** The page of a paged `GET` route: the first, or the URL a `Link` named. */
export function pager(
  channel: Channel,
  route: 'GET /app/installations' | 'GET /installation/repositories',
  headers: RequestHeaders,
) {
  const { octokit } = channel;
  return (url: string | undefined): Promise<Page> =>
    channel.send(route, () =>
      url === undefined
        ? octokit.request(route, { per_page: PER_PAGE, headers })
        : octokit.request({ method: 'GET', url, headers }),
    );
}

/** What `run` answered, or null when it fails with an error `absent` recognises. */
async function nullWhen(run: () => Promise<Page>, absent: (error: unknown) => boolean): Promise<Page | null> {
  try {
    return await run();
  } catch (error) {
    if (absent(error)) {
      return null;
    }
    throw error;
  }
}

/** The answer to `request` read through `schema`, or null for a 404. */
export async function readOrNull<T>(
  channel: Channel,
  route: string,
  request: RawRequest,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const found = await nullWhen(
    () => channel.send(route, request),
    (error) => error instanceof GitHubNotFoundError,
  );
  return found === null ? null : parseOne(route, schema, found.data);
}

/**
 * Like {@link readOrNull}, and a 403 that is a refusal is null too: a repository that is gone and one the installation
 * cannot see look the same from here. A rate limit is not a refusal (see `failureOf`) and still throws.
 */
export async function readOrNullWhenForbidden<T>(
  channel: Channel,
  route: string,
  request: RawRequest,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const absent = (error: unknown): boolean =>
    error instanceof GitHubNotFoundError || error instanceof GitHubForbiddenError;
  const found = await nullWhen(() => channel.send(route, request), absent);
  return found === null ? null : parseOne(route, schema, found.data);
}

/**
 * Whether `request` was answered: true for an answer that `schema` reads (nothing of it is kept), false for a 403 that is
 * a refusal (E14-S05, the permission is missing). A rate limit is not a refusal (see `failureOf`) and still throws, as does
 * every other failure and an answer the schema refuses.
 */
export async function answeredUnlessForbidden(
  channel: Channel,
  route: string,
  request: RawRequest,
  schema: z.ZodType,
): Promise<boolean> {
  const found = await nullWhen(
    () => channel.send(route, request),
    (error) => error instanceof GitHubForbiddenError,
  );
  if (found !== null) {
    parseOne(route, schema, found.data);
  }
  return found !== null;
}
