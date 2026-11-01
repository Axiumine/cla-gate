// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { STATUS_CODES } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import type { errorResponseSchema } from '../../../shared/errors.ts';

type ErrorBody = z.infer<typeof errorResponseSchema>;

/** The status an error maps to. Anything that is not a client error (4xx) is a 500: its details stay in the log. */
function statusOf(error: unknown): number {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return 400;
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = error.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return status;
    }
  }
  return 500;
}

const STATUS_TEXT = new Map(Object.entries(STATUS_CODES));

/** `400` becomes `bad_request`, `500` becomes `internal_server_error`. The message is the standard status text, never ours. */
export function errorBody(status: number, requestId: string): ErrorBody {
  const message = STATUS_TEXT.get(String(status)) ?? 'Error';
  return { error: { code: message.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_'), message, requestId } };
}

function respond(request: FastifyRequest, reply: FastifyReply, status: number): FastifyReply {
  return reply.code(status).type('application/json; charset=utf-8').send(errorBody(status, request.id));
}

/**
 * The error handler: a fixed status text and the request id, never a stack, an internal message or a validation
 * detail. Server errors are logged with the error (see serializeError in logger.ts); client errors are logged without
 * it. Request bodies are never logged. Also the tail of {@link frameworkErrorHandlers}.
 */
export function rejectRequest(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const status = statusOf(error);
  if (status >= 500) {
    request.log.error({ err: error }, 'unhandled error');
  } else {
    request.log.info({ statusCode: status }, 'request rejected');
  }
  return respond(request, reply, status);
}

/** One place decides what a client sees on failure (see {@link rejectRequest}); 404 gets the same body. */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler(rejectRequest);
  app.setNotFoundHandler((request, reply) => respond(request, reply, 404));
}
