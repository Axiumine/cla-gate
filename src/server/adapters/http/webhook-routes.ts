// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import type { Clock } from '../../services/ports/clock.ts';
import { AppError, rejectRequest } from './errors.ts';
import { WEBHOOK_BODY_LIMIT } from './limits.ts';
import { answerFor, routeDelivery, webhookResponseSchemas } from './webhook-answer.ts';
import { readEnvelope } from './webhook-envelope.ts';
import { checkPayload } from './webhook-payload.ts';
import { matchWebhookSignature, type WebhookSecrets } from './webhook-signature.ts';

export interface WebhookRoutesOptions {
  readonly secrets: WebhookSecrets;
  /** Where the once-a-minute limit of the rotation warning takes its time from. */
  readonly clock: Clock;
  /** `GITHUB_APP_ID`: the App a delivery that names its target must have been sent for (E06-S02). */
  readonly appId: string | undefined;
}

/** The rotation warning is logged at most this often, so a busy instance does not drown the log in it. */
const WARNING_INTERVAL_MS = 60_000;

const NO_BODY = Buffer.alloc(0);

/** The bytes GitHub sent. A request with no body at all is never read by the framework, so the plugin may not have seen its end. */
function rawBodyOf(request: FastifyRequest): Buffer {
  return Buffer.isBuffer(request.rawBody) ? request.rawBody : NO_BODY;
}

/**
 * Fastify answers a `Content-Type` that is not a well-formed media type (`application`, `a/b/c`, an empty value) with
 * its own `415` before any `preValidation` hook, which would let an unsigned request see something other than the
 * `401` (E06-S02). The scope therefore takes the header off the request in `onRequest` and keeps it here, by request,
 * for the media type check that follows the signature; a request with no `Content-Type` is read by the catch-all parser.
 */
function holdContentType(app: FastifyInstance): WeakMap<IncomingMessage, string | undefined> {
  const held = new WeakMap<IncomingMessage, string | undefined>();
  app.addHook('onRequest', (request, _reply, done) => {
    held.set(request.raw, request.headers['content-type']);
    delete request.headers['content-type'];
    done();
  });
  return held;
}

/** Fastify's error for a body past the route's limit, by its stable code. */
function isBodyTooLarge(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
}

/**
 * The `preValidation` hook that checks the signature, with the state of the rotation warning (when it was last logged).
 * A callback hook, not an async one: it awaits nothing, and a sync hook without `done` would never finish.
 */
function signatureHook(options: WebhookRoutesOptions) {
  let previousWarnedAt: number | undefined;

  /** One WARN a minute at most, so the operator can tell when no delivery is signed with the old secret any more. */
  function warnPreviousSecretUsed(request: FastifyRequest): void {
    const now = options.clock.now().getTime();
    if (previousWarnedAt === undefined || now - previousWarnedAt >= WARNING_INTERVAL_MS) {
      previousWarnedAt = now;
      request.log.warn('webhook.secret_previous_used');
    }
  }

  /** The failure every refused signature gets, identical whatever the cause; `undefined` when the delivery is signed. */
  function refusal(request: FastifyRequest): AppError | undefined {
    const match = matchWebhookSignature(rawBodyOf(request), request.headers['x-hub-signature-256'], options.secrets);
    if (match === 'none') {
      return new AppError(401, 'webhook_signature_invalid');
    }
    if (match === 'previous') {
      warnPreviousSecretUsed(request);
    }
    return undefined;
  }

  return (request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction): void => {
    done(refusal(request));
  };
}

/**
 * `POST /webhooks/github`, the one route GitHub calls (E06-S01). It sits outside `/api`, so the route audit guard
 * (`requireAuditedRoutes`) does not apply: the route itself mutates nothing audited, and the lifecycle handlers it will
 * hand deliveries to record their own audit rows. It still declares `auditExempt: 'webhook'`, so it stays valid if the
 * path ever moves under `/api`. It has no session, cookie, CSRF or `Origin` dependency: the HMAC is the only credential.
 *
 * The plugin owns an encapsulated scope, which is how `fastify-raw-body` applies to this route only: the plugin keeps
 * the bytes GitHub sent (`encoding: false`, a Buffer; `global: false`, and only a route with `config.rawBody`), and the
 * scope has no content type parser that reads the body: every media type reaches the route as bytes, whatever its
 * `Content-Type`. The checks run in a fixed order (E06-S02, E06-S03): the body size (`413`, by the route's own limit,
 * before any hook), the signature in `preValidation` (`401`, the first hook after the body is read), then in the handler
 * the headers (`400`), the media type (`415`), the JSON (`400`) and the schema of the event (`400`). Nothing parses a
 * body whose signature is wrong (an unsigned request with broken JSON or a form body is a `401`, never a `400` or `415`).
 * Only then does the routing table (E06-S04) decide what the delivery is: a ping is answered, one that maps to no job is
 * a `202` `ignored` with the reason, and one that maps to a job is acknowledged until it is recorded and enqueued (E06-S06).
 */
export const webhookRoutes: FastifyPluginAsyncZod<WebhookRoutesOptions> = async (app, options) => {
  const contentTypes = holdContentType(app);
  // The scope's parsers are replaced, not extended: the default JSON and text parsers would read the body before the hook.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, _body, done) => {
    done(null, undefined);
  });
  await app.register(fastifyRawBody, { global: false, encoding: false, runFirst: true, jsonContentTypes: [] });
  // Fastify's own 413 says `payload_too_large`; this route gives it its own code. Every other error is left to the app's handler.
  app.setErrorHandler((error, request, reply) =>
    rejectRequest(isBodyTooLarge(error) ? new AppError(413, 'webhook_payload_too_large') : error, request, reply),
  );

  app.post(
    WEBHOOK_PATH,
    {
      config: { rawBody: true, auditExempt: 'webhook' },
      bodyLimit: WEBHOOK_BODY_LIMIT,
      preValidation: signatureHook(options),
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: webhookResponseSchemas },
    },
    // The end of the chain so far: the routing table (E06-S04) decides what the delivery is, and the recording and the
    // enqueue (E06-S06) come after it, so a delivery that becomes a job is acknowledged here and nothing more is done yet.
    (request, reply) => {
      const headers = { ...request.headers, 'content-type': contentTypes.get(request.raw) };
      const envelope = readEnvelope(headers, rawBodyOf(request), options.appId);
      const delivery = checkPayload(envelope, request.log);
      const answer = answerFor(routeDelivery(envelope, delivery, options.appId));
      reply.code(answer.statusCode);
      return answer.body;
    },
  );
};
