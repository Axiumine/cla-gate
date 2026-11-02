// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IncomingMessage } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TenantFilter } from '../../services/tenant-filter.ts';
import type { WebhookDeliveries } from '../../services/webhook-deliveries.ts';
import { answerFor, routeDelivery, type WebhookAnswer } from './webhook-answer.ts';
import { withDeadline } from './webhook-deadline.ts';
import { readEnvelope } from './webhook-envelope.ts';
import type { DeliveryLog } from './webhook-log.ts';
import { checkPayload } from './webhook-payload.ts';
import { recordingOf } from './webhook-record.ts';
import { rawBodyOf } from './webhook-signature-hook.ts';

export interface DeliveryHandlerOptions {
  /** `GITHUB_APP_ID`: the App a delivery that names its target must have been sent for (E06-S02). */
  readonly appId: string | undefined;
  /** Milliseconds from the arrival of the request after which it is answered `503` `webhook_timeout` (E06-S07). */
  readonly deadlineMs: number;
  readonly tenants: TenantFilter;
  readonly deliveries: WebhookDeliveries;
  /** The `Content-Type` of each request, taken off its headers before the signature check (see `holdContentType`). */
  readonly contentTypes: WeakMap<IncomingMessage, string | undefined>;
  readonly log: DeliveryLog;
}

/**
 * The end of the chain of the webhook route, for a request whose body size and signature have passed: the headers, the
 * media type and the JSON (E06-S02), the schema of the event (E06-S03), the routing table (E06-S04) that decides what the
 * delivery is, the tenant filter (E06-S05) that decides whether its installation is served and, for what survives, the
 * recording with its job in one transaction (E06-S06). The part that reads the database runs under the deadline
 * (E06-S07). Nothing in it can reach GitHub: the handler holds no client and no token, and the only I/O is the database.
 * What each step learns is noted for the `webhook.received` line.
 */
export function deliveryHandler(options: DeliveryHandlerOptions) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<WebhookAnswer['body']> => {
    const seen = options.log.of(request);
    const headers = { ...request.headers, 'content-type': options.contentTypes.get(request.raw) };
    const envelope = readEnvelope(headers, rawBodyOf(request), options.appId);
    seen.sawEnvelope(envelope);
    const delivery = checkPayload(envelope, request.log);
    if (delivery !== undefined) {
      seen.sawPayload(delivery);
    }
    const routing = routeDelivery(envelope, delivery, options.appId);
    const answer = await withDeadline(options.deadlineMs - reply.elapsedTime, async (signal) => {
      const admitted = await options.tenants.admit(routing, request.log);
      return answerFor(admitted, recordingOf(options.deliveries, envelope, delivery, { log: request.log, signal }));
    });
    seen.answered(answer.body);
    // Assigned, not `reply.code(...)`: the reply is a thenable that settles when the response is sent, so it is never awaited.
    reply.statusCode = answer.statusCode;
    return answer.body;
  };
}
