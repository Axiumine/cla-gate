// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** What a caller may send as a request id: short and boring, so it cannot forge or break a log line. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

/** Keeps a well-formed `X-Request-Id` from the caller (so a trace can span services) and mints a UUID otherwise. */
export function generateRequestId(request: Pick<IncomingMessage, 'headers'>): string {
  // eslint-disable-next-line security/detect-object-injection -- REQUEST_ID_HEADER is a constant, not user input
  const sent = request.headers[REQUEST_ID_HEADER];
  return typeof sent === 'string' && SAFE_ID.test(sent) ? sent : randomUUID();
}
