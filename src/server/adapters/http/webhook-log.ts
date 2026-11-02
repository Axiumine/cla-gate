// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Observation } from './webhook-observation.ts';

// The one line every delivery gets, `webhook.received` (E06-S07). The fields are the ones the line is specified to carry
// and nothing else: constants of this server, the two headers once they have passed their checks, the numeric ids of the
// payload and the action when it has the shape of a GitHub action. No body, no header as it came in, no signature, no
// secret and no client address ever goes into it, so the line is as safe for a hostile delivery as for a real one.

export interface DeliveryLog {
  /** What is known of `request`; the same object for the whole request. */
  of(request: FastifyRequest): Observation;
}

/**
 * Registers the `onResponse` hook of the webhook scope that writes `webhook.received` once the response is out, whatever
 * the response was (a `404` for another method is not in this scope and gets no line). `durationMs` is the time since
 * the request arrived.
 */
export function logDeliveries(app: FastifyInstance): DeliveryLog {
  const observations = new WeakMap<IncomingMessage, Observation>();
  const of = (request: FastifyRequest): Observation => {
    let seen = observations.get(request.raw);
    if (seen === undefined) {
      seen = new Observation();
      observations.set(request.raw, seen);
    }
    return seen;
  };
  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(of(request).fields(Math.round(reply.elapsedTime)), 'webhook.received');
    done();
  });
  return { of };
}
