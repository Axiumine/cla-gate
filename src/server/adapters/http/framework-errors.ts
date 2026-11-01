// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Duplex } from 'node:stream';
import helmetPlugin from '@fastify/helmet';
import Fastify, { type FastifyBaseLogger, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/env.ts';
import { errorBody, rejectRequest } from './errors.ts';
import { generateRequestId, REQUEST_ID_HEADER } from './request-id.ts';
import { securityHeaders } from './security.ts';

type Headers = Readonly<Record<string, string>>;

/** The headers of a response that carry no security meaning, and are left out of {@link securityHeaderValues}. */
const NOT_SECURITY_HEADERS = new Set(['content-type', 'content-length', 'date', 'connection', 'keep-alive']);

/**
 * The security headers the helmet plugin sets, as plain values. Responses that never reach a route (an invalid URL, a
 * request the HTTP parser rejects) skip Fastify's hooks, so the plugin does not run for them. The plugin is run once, with
 * the same options, on a throw-away instance, and the headers of its answer are kept.
 */
async function securityHeaderValues(config: Pick<AppConfig, 'publicBaseUrl'>): Promise<Headers> {
  const probe = Fastify();
  await probe.register(helmetPlugin, securityHeaders(config));
  probe.get('/', () => 'probe');
  const response = await probe.inject('/');
  await probe.close();
  return Object.fromEntries(
    Object.entries(response.headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !NOT_SECURITY_HEADERS.has(entry[0]),
    ),
  );
}

/** What the HTTP parser rejected, as the status Node's own default handler uses. */
function clientErrorStatus(error: Error): number {
  const code = 'code' in error ? error.code : undefined;
  if (code === 'ERR_HTTP_REQUEST_TIMEOUT') {
    return 408;
  }
  return code === 'HPE_HEADER_OVERFLOW' ? 431 : 400;
}

/** A whole HTTP/1.1 response, for a connection that never became a request: the standard body and the same headers. */
function rawResponse(status: number, headers: Headers): string {
  const requestId = generateRequestId({ headers: {} });
  const body = errorBody(status, requestId);
  const text = JSON.stringify(body);
  const fields = {
    ...headers,
    [REQUEST_ID_HEADER]: requestId,
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    connection: 'close',
  };
  const lines = Object.entries(fields).map(([name, value]) => `${name}: ${value}`);
  return [`HTTP/1.1 ${status} ${body.error.message}`, ...lines, '', text].join('\r\n');
}

/**
 * Fastify's two escape hatches for failures that happen before the application sees a request. By default Fastify
 * answers them with its own JSON (the bad-URL one echoes the input and an internal code) and none of our headers.
 * `frameworkErrors` covers an invalid URL escape, an over-long parameter and a failing constraint; `clientErrorHandler`
 * covers what the HTTP parser rejects (garbage, oversized headers, a request that took too long). Both answer with the
 * standard error body, an `x-request-id` and the security headers, like every other response.
 */
export async function frameworkErrorHandlers(config: Pick<AppConfig, 'publicBaseUrl'>, logger: FastifyBaseLogger) {
  const headers = await securityHeaderValues(config);
  return {
    frameworkErrors: (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
      reply.headers({ ...headers, [REQUEST_ID_HEADER]: request.id });
      rejectRequest(error, request, reply);
    },
    clientErrorHandler: (error: Error, socket: Duplex): void => {
      if (('code' in error && error.code === 'ECONNRESET') || socket.destroyed) {
        return;
      }
      logger.trace({ err: error }, 'client error');
      if (socket.writable) {
        socket.write(rawResponse(clientErrorStatus(error), headers));
      }
      socket.destroy(error);
    },
  };
}
