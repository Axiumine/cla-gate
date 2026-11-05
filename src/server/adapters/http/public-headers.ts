// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PUBLIC_API_PREFIX } from '../../../shared/public-verification.ts';
import { type BadgeKind, badgeSvg } from '../../domain/badge-svg.ts';

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
 * What makes an image safe to embed anywhere and to open on its own (E22-S03). The type says it is an image and nothing else, and
 * `nosniff` keeps a browser from reading it as anything else. `Cross-Origin-Resource-Policy: cross-origin` replaces helmet's
 * `same-origin`, which would stop any other site (a README is rendered on github.com, through its image proxy) from showing the
 * image. The policy allows no script, no network and no framing, whatever a browser does with an SVG opened as a page.
 */
const BADGE_HEADERS = {
  'content-type': 'image/svg+xml; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'cross-origin',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
} as const;

/**
 * The image of a badge for a good call (E22-S03): its headers (see {@link BADGE_HEADERS}) and the five minutes a shared cache may keep
 * it, and the bytes to send. It is called after the verdict, never before, so a refusal never carries the headers of an image. As
 * for {@link setPublicCache}, the results of the reply's `headers` and `header` are dropped on purpose.
 */
export function sendBadge(reply: FastifyReply, kind: BadgeKind): string {
  void reply.headers(BADGE_HEADERS);
  setPublicCache(reply);
  return badgeSvg(kind);
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
