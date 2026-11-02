// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { routeWebhook } from '../../domain/webhook-routing.ts';
import { IGNORE_REASONS, type Routing } from '../../domain/webhook-routing-types.ts';
import type { WebhookDelivery } from '../github/webhook-schemas.ts';
import type { WebhookEnvelope } from './webhook-envelope.ts';

// What the webhook route answers once a delivery has passed the checks of E06-S01 to E06-S03 and the routing table
// (E06-S04) has decided what it is. The answers hold constants of this server only, never a header, a payload field or
// any text the delivery chose.

const verifiedSchema = z.object({ status: z.literal('verified') });
const pongSchema = z.object({ status: z.literal('pong') });
const ignoredSchema = z.object({ status: z.literal('ignored'), reason: z.enum(IGNORE_REASONS) });

/** The responses the route declares: `200` for a ping and for a delivery that became a job, `202` for one that did not. */
export const webhookResponseSchemas = {
  200: z.union([verifiedSchema, pongSchema]),
  202: ignoredSchema,
};

/** The body and the status code of an answer. */
export interface WebhookAnswer {
  readonly statusCode: 200 | 202;
  readonly body: z.infer<(typeof webhookResponseSchemas)[200]> | z.infer<(typeof webhookResponseSchemas)[202]>;
}

/**
 * Routes a delivery whose envelope and payload passed their checks. `delivery` is `undefined` for an event with no
 * schema (`ping`, or one nobody subscribed to): the router answers or ignores it without reading its body.
 *
 * @param appId the configured `GITHUB_APP_ID`
 */
export function routeDelivery(
  envelope: WebhookEnvelope,
  delivery: WebhookDelivery | undefined,
  appId: string | undefined,
): Routing {
  const context = { appId, deliveryId: envelope.deliveryId };
  return delivery === undefined
    ? routeWebhook(envelope.event, undefined, undefined, context)
    : routeWebhook(delivery.event, delivery.payload.action, delivery.payload, context);
}

/**
 * The answer for a routing outcome. A delivery that became a job is acknowledged with `verified` until the delivery is
 * recorded and the job enqueued in one transaction (E06-S06), which then answers `accepted` or `duplicate`; an ignored
 * delivery is `202` with the reason (a delivery GitHub should not redeliver, and nothing recorded); a ping is `pong`.
 */
export function answerFor(routing: Routing): WebhookAnswer {
  switch (routing.kind) {
    case 'pong':
      return { statusCode: 200, body: { status: 'pong' } };
    case 'ignored':
      return { statusCode: 202, body: { status: 'ignored', reason: routing.reason } };
    case 'job':
      return { statusCode: 200, body: { status: 'verified' } };
  }
}
