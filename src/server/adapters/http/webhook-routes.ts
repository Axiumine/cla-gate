// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import type { Clock } from '../../services/ports/clock.ts';
import { AppError } from './errors.ts';
import { matchWebhookSignature, type WebhookSecrets } from './webhook-signature.ts';

export interface WebhookRoutesOptions {
  readonly secrets: WebhookSecrets;
  /** Where the once-a-minute limit of the rotation warning takes its time from. */
  readonly clock: Clock;
}

/** The rotation warning is logged at most this often, so a busy instance does not drown the log in it. */
const WARNING_INTERVAL_MS = 60_000;

const verifiedSchema = z.object({ status: z.literal('verified') });

const NO_BODY = Buffer.alloc(0);

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
    // A request with no body at all is never read by the framework, so the plugin may not have seen its end yet.
    const body = Buffer.isBuffer(request.rawBody) ? request.rawBody : NO_BODY;
    const match = matchWebhookSignature(body, request.headers['x-hub-signature-256'], options.secrets);
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
 * `Content-Type`. The signature is checked in `preValidation`, the first hook after the body is read, so nothing
 * parses a body whose signature is wrong (an unsigned request with broken JSON or a form body is a `401`, never a
 * `400` or `415`).
 */
export const webhookRoutes: FastifyPluginAsyncZod<WebhookRoutesOptions> = async (app, options) => {
  // The scope's parsers are replaced, not extended: the default JSON and text parsers would read the body before the hook.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, _body, done) => {
    done(null, undefined);
  });
  await app.register(fastifyRawBody, { global: false, encoding: false, runFirst: true, jsonContentTypes: [] });

  app.post(
    WEBHOOK_PATH,
    {
      config: { rawBody: true, auditExempt: 'webhook' },
      preValidation: signatureHook(options),
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: verifiedSchema } },
    },
    // The end of the chain so far: the envelope checks (S02), the event schemas (S03) and the rest come after the
    // signature, so an authenticated delivery is acknowledged here and nothing more is done with it yet.
    (): z.infer<typeof verifiedSchema> => ({ status: 'verified' }),
  );
};
