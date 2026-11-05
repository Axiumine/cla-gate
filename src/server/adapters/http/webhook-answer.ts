// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { Job } from '../../domain/jobs.ts';
import { routeWebhook } from '../../domain/webhook-routing.ts';
import { type DestroyedGroup, IGNORE_REASONS, type Routing } from '../../domain/webhook-routing-types.ts';
import type { AdmittedRouting } from '../../domain/webhook-tenant.ts';
import type { DeliveryOutcome } from '../../services/webhook-deliveries.ts';
import type { WebhookDelivery } from '../github/webhook-schemas.ts';
import type { WebhookEnvelope } from './webhook-envelope.ts';

// What the webhook route answers once a delivery has passed the checks of E06-S01 to E06-S03, the routing table
// (E06-S04) has decided what it is, the tenant filter (E06-S05) has judged the installation it names and, for a delivery
// that starts a job, the delivery has been recorded and the job sent (E06-S06). The answers hold constants of this
// server only, never a header, a payload field or any text the delivery chose.

const pongSchema = z.object({ status: z.literal('pong') });
const duplicateSchema = z.object({ status: z.literal('duplicate') });
const acceptedSchema = z.object({ status: z.literal('accepted') });
const ignoredSchema = z.object({ status: z.literal('ignored'), reason: z.enum(IGNORE_REASONS) });

/**
 * The responses the route declares: `200` for a ping and for a delivery that was already recorded, `202` for one that
 * was recorded now and for one that starts nothing.
 */
export const webhookResponseSchemas = {
  200: z.union([pongSchema, duplicateSchema]),
  202: z.union([acceptedSchema, ignoredSchema]),
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
 * @param envelope the event, the delivery id and the parsed body of the delivery, which passed the envelope checks
 * @param delivery the delivery as its event's schema left it, or `undefined` for an event with no schema
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
 * What {@link answerFor} calls to record a delivery (E06-S06): `job` records a delivery that starts one and sends it; `destroyed`
 * (E22-S01) records the delivery of a merge group GitHub took down and marks its evaluation, with no job.
 */
export interface RecordDelivery {
  readonly job: (job: Job) => Promise<DeliveryOutcome>;
  readonly destroyed: (group: DestroyedGroup) => Promise<DeliveryOutcome>;
}

const DUPLICATE: WebhookAnswer = { statusCode: 200, body: { status: 'duplicate' } };

/**
 * The answer for what a delivery became. A ping is `200` `pong`; a delivery that starts nothing is `202` `ignored` with
 * the reason (one GitHub should not redeliver, and nothing recorded). A delivery that starts a job is recorded and its
 * job sent through `record` first: `202` `accepted` when it was recorded now, `200` `duplicate` when it was already.
 * A delivery the tenant filter replaced by a sync (E06-S05) is recorded the same way, as the sync it became, and is
 * answered `202` `ignored` with the reason it was replaced for (its event is not acted on, and the reason is what an
 * operator reads in GitHub's delivery log), or `200` `duplicate`. A merge group taken down is recorded with no job and answered
 * like a job: `202` `accepted`, or `200` `duplicate` for a redelivery. A `record` that fails is not caught here.
 */
export async function answerFor(admitted: AdmittedRouting, record: RecordDelivery): Promise<WebhookAnswer> {
  switch (admitted.kind) {
    case 'pong':
      return { statusCode: 200, body: { status: 'pong' } };
    case 'ignored':
      return { statusCode: 202, body: { status: 'ignored', reason: admitted.reason } };
    case 'redirected':
      return (await record.job(admitted.job)) === 'duplicate'
        ? DUPLICATE
        : { statusCode: 202, body: { status: 'ignored', reason: admitted.reason } };
    case 'job':
      return (await record.job(admitted.job)) === 'duplicate'
        ? DUPLICATE
        : { statusCode: 202, body: { status: 'accepted' } };
    case 'destroyed':
      return (await record.destroyed(admitted.group)) === 'duplicate'
        ? DUPLICATE
        : { statusCode: 202, body: { status: 'accepted' } };
  }
}
