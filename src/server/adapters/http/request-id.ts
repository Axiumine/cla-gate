// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** What a caller may send as a request id: short and boring, so it cannot forge or break a log line. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

/** What the id of a request is read from: its headers. */
type RequestLike = Pick<IncomingMessage, 'headers'>;

/**
 * Keeps a well-formed `X-Request-Id` from the caller (so a trace can span services) and mints a UUID otherwise. The
 * webhook scope does not use it: it mints every id itself ({@link mintRequestId}).
 */
export function generateRequestId(request: RequestLike): string {
  // eslint-disable-next-line security/detect-object-injection -- REQUEST_ID_HEADER is a constant, not user input
  const sent = request.headers[REQUEST_ID_HEADER];
  return typeof sent === 'string' && SAFE_ID.test(sent) ? sent : mintRequestId();
}

/**
 * A fresh UUID, whatever the request carries. The webhook scope sets it as its generator (`setGenReqId`, E06-S07): no
 * value of a header of a webhook delivery may reach the log, where the request id is written on every line. Fastify asks
 * the generator of the scope the router matched, so this holds for every spelling of the path the router resolves to the
 * route (percent-escapes, a fragment, the absolute form of the target), which a comparison of the URL with the path could
 * not promise.
 */
export function mintRequestId(): string {
  return randomUUID();
}
