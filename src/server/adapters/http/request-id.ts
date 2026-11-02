// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';

/** What a caller may send as a request id: short and boring, so it cannot forge or break a log line. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

/** What the id of a request is minted from: its headers and the URL it asked for (the query string is not part of the path). */
type RequestLike = Pick<IncomingMessage, 'headers'> & { readonly url?: string | undefined };

/**
 * Keeps a well-formed `X-Request-Id` from the caller (so a trace can span services) and mints a UUID otherwise. The
 * webhook route never keeps one (E06-S07): GitHub sends none, and no value of a header of a webhook delivery may reach
 * the log, where the request id is written on every line.
 */
export function generateRequestId(request: RequestLike): string {
  // eslint-disable-next-line security/detect-object-injection -- REQUEST_ID_HEADER is a constant, not user input
  const sent = request.headers[REQUEST_ID_HEADER];
  const kept = typeof sent === 'string' && SAFE_ID.test(sent) && request.url?.split('?', 1)[0] !== WEBHOOK_PATH;
  return kept ? sent : randomUUID();
}
