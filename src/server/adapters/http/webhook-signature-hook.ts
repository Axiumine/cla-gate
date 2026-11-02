// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import type { Clock } from '../../services/ports/clock.ts';
import { AppError } from './errors.ts';
import { matchWebhookSignature, type WebhookSecrets } from './webhook-signature.ts';

// The signature check of the webhook route (E06-S01) as a `preValidation` hook, apart from the route so that the route
// stays about the order of the checks.

export interface SignatureHookOptions {
  readonly secrets: WebhookSecrets;
  /** Where the once-a-minute limit of the rotation warning takes its time from. */
  readonly clock: Clock;
}

/** The rotation warning is logged at most this often, so a busy instance does not drown the log in it. */
const WARNING_INTERVAL_MS = 60_000;

const NO_BODY = Buffer.alloc(0);

/** The bytes GitHub sent. A request with no body at all is never read by the framework, so the plugin may not have seen its end. */
export function rawBodyOf(request: FastifyRequest): Buffer {
  return Buffer.isBuffer(request.rawBody) ? request.rawBody : NO_BODY;
}

/**
 * The `preValidation` hook that checks the signature, with the state of the rotation warning (when it was last logged).
 * A callback hook, not an async one: it awaits nothing, and a sync hook without `done` would never finish.
 */
export function signatureHook(options: SignatureHookOptions) {
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
