// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type DestinationStream, type Logger, pino } from 'pino';
import { PUBLIC_API_PREFIX } from '../../../shared/public-verification.ts';
import type { AppConfig } from '../../config/env.ts';

/** Header names that are credentials, wherever they turn up as a key (a header map under another name, say). */
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key'].flatMap(
  (name) => [
    name,
    name.replaceAll(/(^|-)([a-z])/g, (_match, dash: string, letter: string) => dash + letter.toUpperCase()),
  ],
);

/**
 * Nothing inside a `headers` object reaches a log line, whatever the header is called or how it is capitalised
 * (`x-forwarded-for` and `user-agent` are network metadata, which docs/architecture.md keeps out of the log), at the
 * top level or up to three objects deep (`request.raw.headers`). The serializers below do not log headers at all; this
 * is a second line of defence for the day somebody logs a request or a reply. The credential names are also redacted
 * when they stand alone as keys, up to two levels deep, in lower case and as `Title-Case`.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const REDACT_PATHS = [
  ...['', '*.', '*.*.', '*.*.*.'].map((prefix) => `${prefix}headers.*`),
  ...['', '*', '*.*'].flatMap((prefix) => CREDENTIAL_HEADERS.map((name) => `${prefix}["${name}"]`)),
];

interface LoggedRequest {
  readonly method?: string;
  readonly url?: string;
  /** What Fastify's request knows of the route that matched: its template, in `url`; a plain object has none. */
  readonly routeOptions?: { readonly url?: string | undefined };
}

/** How many times a path is percent-decoded to see what it names: more than that is an attempt to hide, and is masked. */
const MAX_DECODES = 3;

/** `path` decoded once, or as it is when it holds an escape that is not valid. */
function decodedOnce(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The spelling every router and every reader folds together: lower case, one kind of slash, no doubled slash. */
const flattened = (path: string): string =>
  path
    .toLowerCase()
    .replaceAll('\\', '/')
    .replaceAll(/\/{2,}/g, '/');

/**
 * Whether a path names the public API in any spelling a router could still serve or a reader would take for it: escaped letters
 * (`/api/%70ublic/`), capitals, doubled slashes or a prefix that is itself escaped twice. A path that is still changing after
 * {@link MAX_DECODES} decodes is masked too. A path that matched no route is judged by this alone, and a request that matched a
 * route of the public API is logged by its template whatever its path looked like (see {@link serializeRequest}).
 */
function readsAsPublic(path: string): boolean {
  let spelled = path;
  for (let pass = 0; pass <= MAX_DECODES; pass++) {
    if (flattened(spelled).includes(PUBLIC_API_PREFIX)) {
      return true;
    }
    const decoded = decodedOnce(spelled);
    if (decoded === spelled) {
      return false;
    }
    spelled = decoded;
  }
  return true;
}

/**
 * Method and path only. No headers, no body, no query string (OAuth `code` and `state` live there), and no client
 * address: network metadata is not recorded unless a configuration flag asks for it (docs/architecture.md), and a log
 * is a record. A request of the public API (E22-S02) is logged by the template of the route that matched
 * (`/api/public/repos/:githubRepoId/signers/:login`) and not by its path, which names a person's login, whatever the path looked
 * like (the router reads `/api/%70ublic/` as the same route); one that matched no public route but reads as the public API in
 * any spelling (see {@link readsAsPublic}) is logged as `/api/public/*`.
 */
function serializeRequest(request: LoggedRequest): Record<string, unknown> {
  const path = request.url?.split('?', 1)[0];
  const template = request.routeOptions?.url;
  if (template?.startsWith(PUBLIC_API_PREFIX) === true) {
    return { method: request.method, url: template };
  }
  const masked = path !== undefined && readsAsPublic(path);
  return { method: request.method, url: masked ? `${PUBLIC_API_PREFIX}*` : path };
}

function serializeResponse(reply: { readonly statusCode?: number }): Record<string, unknown> {
  return { statusCode: reply.statusCode };
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * A PostgreSQL error message can quote the offending value (`invalid input syntax for type bigint: "jane@example.com"`)
 * and so can the `detail`, which would put personal data in the log. For a database error (a SQLSTATE `code` and a
 * `severity`) only the code and the names of the constraint, table and column are logged, plus the stack frames. V8
 * starts a stack with the message, so those lines are cut off: the frames begin after the message's last line.
 */
function serializeDatabaseError(error: Error, code: string): Record<string, unknown> {
  const frames = error.stack?.split('\n').slice(error.message.split('\n').length);
  const names = Object.fromEntries(
    ['constraint', 'table', 'column'].flatMap((field): [string, string][] => {
      const value = stringField(error, field);
      return value === undefined ? [] : [[field, value]];
    }),
  );
  return { type: error.name, message: 'database error (details withheld)', code, ...names, stack: frames?.join('\n') };
}

function stringField(error: Error, field: string): string | undefined {
  const value: unknown = Reflect.get(error, field);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Class, message, code and stack only. The default serializer also copies every enumerable property, and a database
 * error carries `detail`, the offending row's values, which would put personal data in the log. A database error is
 * logged without its message for the same reason (see {@link serializeDatabaseError}).
 */
function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error };
  }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code !== undefined && SQLSTATE.test(code) && 'severity' in error) {
    return serializeDatabaseError(error, code);
  }
  return { type: error.name, message: error.message, code, stack: error.stack };
}

/** The application logger (pino): JSON lines with redaction and with serializers that never log bodies or headers. */
export function createLogger(config: Pick<AppConfig, 'logLevel'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.logLevel,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
