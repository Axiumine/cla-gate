// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { STATUS_CODES } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import type { errorDetailsSchema, errorResponseSchema } from '../../../shared/errors.ts';
import { upstreamFailure } from './upstream-failure.ts';

type ErrorBody = z.infer<typeof errorResponseSchema>;
type ErrorDetails = z.infer<typeof errorDetailsSchema>;

const ERROR_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * A failure the client is told about by its own stable code (E06-S01): the handler sends `code` and, only when given,
 * `details` (a plain JSON object), while `message` stays the standard text of `status`. Every domain code of the API
 * (`webhook_signature_invalid`, and those of E10 to E16) is thrown this way. Neither the thrower's reasons nor anything
 * secret belongs in `details`: the client sees it as it is. A server error (5xx) is logged with its stack.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetails | undefined;

  constructor(status: number, code: string, details?: ErrorDetails) {
    super(code);
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError('an AppError status is an integer from 400 to 599');
    }
    if (!ERROR_CODE.test(code)) {
      throw new RangeError('an AppError code is lower-case snake_case');
    }
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The status an error maps to. An {@link AppError} says its own; anything else that is not a client error (4xx) is a 500: its details stay in the log. */
function statusOf(error: unknown): number {
  if (error instanceof AppError) {
    return error.status;
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    return 400;
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = error.statusCode;
    if (typeof status === 'number' && status >= 400 && status <= 499) {
      return status;
    }
  }
  return 500;
}

const STATUS_TEXT = new Map(Object.entries(STATUS_CODES));

/**
 * `400` becomes `bad_request`, `500` becomes `internal_server_error`. The message is the standard status text, never
 * ours. An {@link AppError} brings its own code, and its details when it has any.
 */
export function errorBody(status: number, requestId: string, error?: AppError): ErrorBody {
  const message = STATUS_TEXT.get(String(status)) ?? 'Error';
  // Stryker disable next-line Regex: no standard status text has two separators in a row, so the + changes nothing for any text this map holds
  const code = error?.code ?? message.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_');
  const details = error?.details === undefined ? {} : { details: error.details };
  return { error: { code, message, requestId, ...details } };
}

function respond(request: FastifyRequest, reply: FastifyReply, status: number, error?: AppError): FastifyReply {
  // Stryker disable next-line StringLiteral: Fastify gives an object body this very content type by itself; it is spelled out so it never depends on that
  return reply
    .code(status)
    .type('application/json; charset=utf-8')
    .send(errorBody(status, request.id, error));
}

/**
 * The error handler: a fixed status text and the request id, never a stack, an internal message or a validation
 * detail. Server errors are logged with the error (see serializeError in logger.ts); client errors are logged without
 * it, with the code of an {@link AppError}. Request bodies are never logged. Also the tail of {@link frameworkErrorHandlers}.
 * A failure to learn what a person may do (GitHub down or limiting, E11-S04) becomes its `AppError` here, with the
 * `retry-after` header, so every route that asks for a role answers the same way; see {@link upstreamFailure}.
 */
export function rejectRequest(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const upstream = upstreamFailure(error);
  const failure = upstream === undefined ? error : new AppError(upstream.status, upstream.code);
  const status = statusOf(failure);
  const app = failure instanceof AppError ? failure : undefined;
  if (upstream?.retryAfterSeconds !== undefined) {
    // The reply is a thenable that settles when the response is sent: the result of `header` is dropped, never awaited.
    void reply.header('retry-after', String(upstream.retryAfterSeconds));
  }
  if (upstream !== undefined) {
    // GitHub failing is not a defect of ours: no stack, and a warning so that an outage is visible.
    request.log.warn({ statusCode: status, code: upstream.code }, 'request rejected');
  } else if (status >= 500) {
    request.log.error({ err: error }, 'unhandled error');
  } else {
    request.log.info({ statusCode: status, ...(app === undefined ? {} : { code: app.code }) }, 'request rejected');
  }
  return respond(request, reply, status, app);
}

/** One place decides what a client sees on failure (see {@link rejectRequest}); 404 gets the same body. */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler(rejectRequest);
  app.setNotFoundHandler((request, reply) => respond(request, reply, 404));
}
