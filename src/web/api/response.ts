// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Route, responseSchemaFor } from '../../shared/contract.ts';
import { errorResponseSchema } from '../../shared/errors.ts';
import { ApiError, ContractError, issuePaths, NetworkError } from './errors.ts';
import { parseRetryAfter } from './retry-after.ts';

// How an answer becomes a value or an error (E17-S04). A success body is parsed strictly against the schema of its
// status; an error body is read as the standard envelope (E04), and anything else is `unexpected_response`.

/** The status that always means "log in again", whatever the body says (the server's own code for it is `unauthorized`). */
export const UNAUTHENTICATED_STATUS = 401;
const UNAUTHENTICATED = 'unauthenticated';
const UNEXPECTED_RESPONSE = 'unexpected_response';
/**
 * What the server's own request ids look like; a header from anywhere else is not trusted into an error, and an id that does
 * not look like this is not shown on a screen (E17-S07).
 */
export const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** An abort is not a failure of the network: the caller asked for it, and it passes through as the original error. */
function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

/** Waits for `work`; a rejection is a {@link NetworkError}, except an abort, which rejects with the original error. */
export async function guarded<Value>(work: Promise<Value>, signal: AbortSignal | undefined): Promise<Value> {
  try {
    return await work;
  } catch (error) {
    throw isAbort(error, signal) ? error : new NetworkError(error);
  }
}

function parseJson(text: string): unknown {
  return text === '' ? undefined : JSON.parse(text);
}

/** The value of a success answer, parsed against the schema the route declares for its status. */
export async function readSuccess(route: Route, response: Response, signal: AbortSignal | undefined): Promise<unknown> {
  const text = await guarded(response.text(), signal);
  const schema = responseSchemaFor(route, response.status);
  if (schema === undefined) {
    throw new ContractError(route.name, 'response', []);
  }
  let value: unknown;
  try {
    value = parseJson(text);
  } catch {
    throw new ContractError(route.name, 'response', []);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ContractError(route.name, 'response', issuePaths(result.error));
  }
  return result.data;
}

/** The standard error envelope in `text`, or `undefined` when the text is not JSON or not the envelope. */
function parseEnvelope(text: string) {
  try {
    return errorResponseSchema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

function headerRequestId(response: Response): string | undefined {
  const sent = response.headers.get('x-request-id');
  return sent !== null && REQUEST_ID.test(sent) ? sent : undefined;
}

/** The {@link ApiError} for an answer outside 2xx. `nowMs` is the clock a `Retry-After` date counts from. */
export async function readError(response: Response, nowMs: number, signal: AbortSignal | undefined): Promise<ApiError> {
  const envelope = parseEnvelope(await guarded(response.text(), signal));
  const status = response.status;
  return new ApiError({
    status,
    code: status === UNAUTHENTICATED_STATUS ? UNAUTHENTICATED : (envelope?.error.code ?? UNEXPECTED_RESPONSE),
    requestId: envelope?.error.requestId ?? headerRequestId(response),
    retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after'), nowMs),
  });
}
