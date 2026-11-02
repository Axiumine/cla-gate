// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply } from 'fastify';

/**
 * Marks the answer as not to be stored by any cache. It is a function of its own, and not a line of the handler, because
 * a Fastify reply is a thenable that settles when the response is sent: the result of `header` is dropped on purpose, and
 * inside an `async` handler that reads as a missing `await` (awaiting it would wait for the response it is part of).
 */
export function setNoStore(reply: FastifyReply): void {
  void reply.header('cache-control', 'no-store');
}
