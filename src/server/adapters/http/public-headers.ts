// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PUBLIC_API_PREFIX } from '../../../shared/public-verification.ts';

// The headers of the public routes (E22-S02, and the badges of E22-S03 after it): what any site may read, and what a cache may keep.

/** The header that lets any site read an answer of the public API: it is public, and answered to `GET` only. */
const PUBLIC_CORS = { 'access-control-allow-origin': '*' } as const;

/** The headers of a refusal of the public API: readable by any site, and never kept by a cache. */
export const PUBLIC_REFUSAL_HEADERS = { ...PUBLIC_CORS, 'cache-control': 'no-store' } as const;

/** Whether `url` (path and query, as the request line has it) is a call of the public API, whatever route it reaches. */
export const isPublicUrl = (url: string): boolean => url.startsWith(PUBLIC_API_PREFIX);

/** What a shared cache may keep the answer to a good call for: five minutes. */
const PUBLIC_CACHE_CONTROL = 'public, max-age=300';

/**
 * Marks the answer as one that a shared cache may keep for five minutes. It is a function of its own, and not a line of the handler,
 * because a Fastify reply is a thenable that settles when the response is sent: the result of `header` is dropped on purpose, and
 * inside an `async` handler that reads as a missing `await` (awaiting it would wait for the response it is part of).
 */
export function setPublicCache(reply: FastifyReply): void {
  void reply.header('cache-control', PUBLIC_CACHE_CONTROL);
}

/**
 * The `onSend` hook of the public routes: every answer, a failure as well, may be read by any site
 * (`Access-Control-Allow-Origin: *`; the routes answer `GET` only), and only a `200` may be stored by a cache, which the handler
 * says itself with {@link setPublicCache}: a refusal, a limit and an outage are marked `no-store`. The routes read no session, so
 * no answer sets a cookie.
 */
export function publicHeaders(
  _request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  done: (error: Error | null, payload: unknown) => void,
): void {
  void reply.headers(reply.statusCode === 200 ? PUBLIC_CORS : PUBLIC_REFUSAL_HEADERS);
  done(null, payload);
}
