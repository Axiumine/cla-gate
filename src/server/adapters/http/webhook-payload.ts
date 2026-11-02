// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import { hasPayloadSchema, type WebhookDelivery, webhookDeliverySchema } from '../github/webhook-schemas.ts';
import { AppError } from './errors.ts';
import type { WebhookEnvelope } from './webhook-envelope.ts';

/**
 * The places a payload failed, as the dotted path of each field (`installation.id`, `pull_request.head.sha`), once
 * each. A path comes from the schema, never from the payload, and no value is read: a refused delivery tells the
 * operator which field is wrong and nothing of what it held. The first segment is the `payload` member of the
 * delivery schema.
 */
function failedPaths(error: z.ZodError): string[] {
  const paths = error.issues.map((issue) => issue.path.slice(1).map(String).join('.'));
  return [...new Set(paths)];
}

/**
 * Checks the payload of a delivery that passed the envelope against the schema of its event (E06-S03), the last step
 * of the fixed order before anything is recorded. A payload that fails is a `400` `webhook_payload_invalid` whose
 * `details.paths` lists the failed fields, and the same list is logged once; neither holds a value, so a hostile
 * delivery cannot put its own text in the response or the log. An error that is not a validation failure (a schema that
 * throws) is not caught: the error handler answers it with a `500` and the log gets the error without the body.
 *
 * @returns the delivery with its payload stripped to the declared fields, or `undefined` for an event with no schema
 *   (`ping`, or one nobody subscribed to), which is the router's to ignore or answer (E06-S04)
 * @throws AppError `400` `webhook_payload_invalid`
 */
export function checkPayload(
  envelope: WebhookEnvelope,
  log: Pick<FastifyBaseLogger, 'info'>,
): WebhookDelivery | undefined {
  if (!hasPayloadSchema(envelope.event)) {
    return undefined;
  }
  const result = webhookDeliverySchema.safeParse({ event: envelope.event, payload: envelope.payload });
  if (!result.success) {
    const paths = failedPaths(result.error);
    log.info({ event: envelope.event, paths }, 'webhook.payload_invalid');
    throw new AppError(400, 'webhook_payload_invalid', { paths });
  }
  return result.data;
}
