// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyBaseLogger } from 'fastify';
import type { WebhookDeliveries } from '../../services/webhook-deliveries.ts';
import type { WebhookDelivery } from '../github/webhook-schemas.ts';
import { AppError } from './errors.ts';
import type { RecordDelivery } from './webhook-answer.ts';
import type { WebhookEnvelope } from './webhook-envelope.ts';

// The part of the webhook route that records a delivery and sends its job (E06-S06): what is kept of the delivery, and
// what a failure of the recording is answered with.

/** The `action` of the checked payload, or `null` for an event that has no schema (a ping, an event nobody subscribed to). */
function actionOf(delivery: WebhookDelivery | undefined): string | null {
  return delivery === undefined ? null : delivery.payload.action;
}

/**
 * The recording of one delivery, for {@link answerFor}. It keeps the id the envelope parsed, the event header and the
 * action of the checked payload, and nothing else of the delivery. Any failure (the send, a statement, the connection
 * of the transaction) has rolled the transaction back, so no row exists; it is answered `503` `webhook_enqueue_failed`,
 * which GitHub's delivery log shows and a redelivery retries under the same id. The cause is logged (a database error
 * without the values it quotes, see the `err` serialiser), never the request or the job.
 */
export function recordingOf(
  deliveries: WebhookDeliveries,
  envelope: WebhookEnvelope,
  delivery: WebhookDelivery | undefined,
  log: Pick<FastifyBaseLogger, 'error'>,
): RecordDelivery {
  const subject = { deliveryId: envelope.deliveryId, event: envelope.event, action: actionOf(delivery) };
  return async (job) => {
    try {
      return await deliveries.record(subject, job);
    } catch (error) {
      log.error({ err: error }, 'webhook.enqueue_failed');
      throw new AppError(503, 'webhook_enqueue_failed');
    }
  };
}
