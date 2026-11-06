// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { errorDetailsSchema } from '../../shared/errors.ts';

// The three failures of the API client (E17-S04). None of them carries a response body, a header value or a request
// parameter in its message, so an error that reaches a log or a screen leaks no payload.

/** The `details` object of an error body: plain JSON a domain error attaches to its code (E06-S01), read by the screen that knows the code. */
export type ErrorDetails = z.infer<typeof errorDetailsSchema>;

/**
 * The server answered with an error (a status outside 2xx). `code` is the stable machine code of the error body, or
 * `unauthenticated` for every 401 and `unexpected_response` when the body is not the standard error body. `requestId` is
 * what support asks for: the body's, else the `X-Request-Id` header's, else `undefined`. `details` is the body's `details` object
 * when it has one (E18-S05: the number of signatures a publish would stale, the revision a draft is at): never shown as it is, a
 * screen reads the keys it knows through its own schema.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly details: ErrorDetails | undefined;

  constructor(init: {
    readonly status: number;
    readonly code: string;
    readonly requestId?: string | undefined;
    readonly retryAfterSeconds?: number | undefined;
    readonly details?: ErrorDetails | undefined;
  }) {
    super(`The request failed with status ${init.status}`);
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.details = init.details;
  }
}

/** Which part of an exchange broke its contract. */
export type ContractPart = 'params' | 'query' | 'body' | 'response';

/** A path is cut at this length and the list at {@link MAX_PATHS}: a hostile payload cannot make the error large. */
const MAX_PATH_LENGTH = 80;
const MAX_PATHS = 20;

/** The paths of the issues of a failed parse (`items.0.name`; `$` is the root), never a value. */
export function issuePaths(error: z.ZodError): string[] {
  return error.issues
    .slice(0, MAX_PATHS)
    .map((issue) => (issue.path.length === 0 ? '$' : issue.path.map(String).join('.').slice(0, MAX_PATH_LENGTH)));
}

function describe(routeName: string, part: ContractPart, paths: readonly string[]): string {
  const where = paths.length === 0 ? '' : ` at ${paths.join(', ')}`;
  return `The ${part} of ${routeName} does not match its contract${where}`;
}

/**
 * A request or a response that does not match the schema of its route. It names the route (`GET /api/x/:id`, the template,
 * never the filled path), the part and the zod issue paths, and nothing of the data.
 */
export class ContractError extends Error {
  override readonly name = 'ContractError';
  readonly routeName: string;
  readonly part: ContractPart;
  readonly paths: readonly string[];

  constructor(routeName: string, part: ContractPart, paths: readonly string[]) {
    super(describe(routeName, part, paths));
    this.routeName = routeName;
    this.part = part;
    this.paths = paths;
  }
}

/** The request never got an answer: the browser is offline, the connection broke, or the server could not be reached. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';

  constructor(cause: unknown) {
    super('The request could not reach the server', { cause });
  }
}
