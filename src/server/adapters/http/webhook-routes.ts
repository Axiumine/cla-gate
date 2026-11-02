// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { createFailureThrottle, SIGNATURE_FAILURE_LIMITS } from '../../services/failure-throttle.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { createTenantFilter } from '../../services/tenant-filter.ts';
import { createWebhookDeliveries } from '../../services/webhook-deliveries.ts';
import type { Database } from '../db/schema.ts';
import { AppError, rejectRequest } from './errors.ts';
import { WEBHOOK_BODY_LIMIT } from './limits.ts';
import { mintRequestId } from './request-id.ts';
import { webhookResponseSchemas } from './webhook-answer.ts';
import { deliveryHandler } from './webhook-handler.ts';
import { logDeliveries } from './webhook-log.ts';
import { type SignatureHookOptions, signatureHook } from './webhook-signature-hook.ts';
import { throttleGuard } from './webhook-throttle.ts';

export interface WebhookRoutesOptions extends SignatureHookOptions {
  /** `GITHUB_APP_ID`: the App a delivery that names its target must have been sent for (E06-S02). */
  readonly appId: string | undefined;
  /** What the tenant filter reads the stored installations and repositories from (E06-S05), and the deliveries are recorded in (E06-S06). Not closed by the route. */
  readonly db: Kysely<Database>;
  /** Where the job of a delivery is sent, in the transaction that records the delivery (E06-S06). */
  readonly enqueuer: JobEnqueuer;
  /** Milliseconds from the arrival of a request after which it is answered `503` `webhook_timeout` (E06-S07). */
  readonly deadlineMs: number;
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
 * `POST /webhooks/github`, the one route GitHub calls (E06-S01). It sits outside `/api`, so the route audit guard
 * (`requireAuditedRoutes`) does not apply: the route itself mutates nothing audited (the delivery it records is operational
 * state, not an audit row), and the lifecycle handlers it hands deliveries to record their own audit rows. It still declares `auditExempt: 'webhook'`, so it stays valid if the
 * path ever moves under `/api`. It has no session, cookie, CSRF or `Origin` dependency: the HMAC is the only credential, so the route sets `csrf: 'exempt'` (E10-S03) and `rateLimit: false` (E10-S08), which also keeps the session lookup off it; both closed lists match its routed path, never `request.url`.
 * Any other method on the path is no route of this scope: Fastify answers it `404` with the standard error body before a
 * hook or a handler of the scope runs (E06-S07).
 *
 * The plugin owns an encapsulated scope, which is how `fastify-raw-body` applies to this route only: the plugin keeps
 * the bytes GitHub sent (`encoding: false`, a Buffer; `global: false`, and only a route with `config.rawBody`), and the
 * scope has no content type parser that reads the body: every media type reaches the route as bytes, whatever its
 * `Content-Type`. An address with too many failed signatures is turned away first, `429`, before its body is read
 * (E06-S07). The checks run in a fixed order (E06-S02, E06-S03): the body size (`413`, by the route's own limit,
 * before any hook), the signature in `preValidation` (`401`, the first hook after the body is read), then in the handler
 * the headers (`400`), the media type (`415`), the JSON (`400`) and the schema of the event (`400`). Nothing parses a
 * body whose signature is wrong (an unsigned request with broken JSON or a form body is a `401`, never a `400` or `415`).
 * Only then does the routing table (E06-S04) decide what the delivery is: a ping is answered, one that maps to no job is
 * a `202` `ignored` with the reason, and one that maps to a job is judged by the tenant filter (E06-S05), which reads the
 * stored installation (a database read, never a GitHub call) and turns away a delivery of an installation the instance
 * does not serve. What survives is recorded and its job sent in one transaction (E06-S06): `202` `accepted` for a delivery
 * recorded now, `200` `duplicate` for one recorded before, `503` `webhook_enqueue_failed` when the transaction failed
 * (nothing is kept, so a redelivery works). A ping and an ignored delivery record nothing. All of that runs under a
 * deadline (`503` `webhook_timeout`, E06-S07), and every delivery ends with one `webhook.received` line.
 */
export const webhookRoutes: FastifyPluginAsyncZod<WebhookRoutesOptions> = async (app, options) => {
  // Encapsulated: only this scope mints its ids. Fastify asks the generator of the scope the router matched, so a caller's `X-Request-Id` never reaches a log line of a delivery, however the path is spelled.
  app.setGenReqId(mintRequestId);
  const log = logDeliveries(app);
  const contentTypes = holdContentType(app);
  const throttle = createFailureThrottle({ clock: options.clock, ...SIGNATURE_FAILURE_LIMITS });
  app.addHook('onRequest', throttleGuard(throttle));
  const tenants = createTenantFilter({ db: options.db, clock: options.clock });
  const deliveries = createWebhookDeliveries({ db: options.db, enqueuer: options.enqueuer });
  // The scope's parsers are replaced, not extended: the default JSON and text parsers would read the body before the hook.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, _body, done) => {
    done(null, undefined);
  });
  await app.register(fastifyRawBody, { global: false, encoding: false, runFirst: true, jsonContentTypes: [] });
  // Fastify's own 413 says `payload_too_large`; this route gives it its own code. Every other error is left to the app's handler.
  app.setErrorHandler((error, request, reply) => {
    const refusal = isBodyTooLarge(error) ? new AppError(413, 'webhook_payload_too_large') : error;
    log.of(request).refused(refusal);
    return rejectRequest(refusal, request, reply);
  });

  app.post(
    WEBHOOK_PATH,
    {
      config: { rawBody: true, auditExempt: 'webhook', csrf: 'exempt', rateLimit: false },
      bodyLimit: WEBHOOK_BODY_LIMIT,
      preValidation: signatureHook(options, throttle),
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: webhookResponseSchemas },
    },
    deliveryHandler({ appId: options.appId, deadlineMs: options.deadlineMs, tenants, deliveries, contentTypes, log }),
  );
};
