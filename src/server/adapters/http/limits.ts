// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * Explicit HTTP server limits, so none of them is whatever Fastify or Node happen to default to (Fastify leaves
 * `requestTimeout` and `connectionTimeout` unlimited: a client that sends its headers and then drips the body is never
 * cut off). All times are milliseconds.
 */
export const HTTP_LIMITS = {
  /** A socket that stays silent for this long is dropped (Node's `server.timeout`). */
  connectionTimeout: 30_000,
  /** The whole request, headers and body, must arrive within this time. */
  requestTimeout: 30_000,
  /** The request line and headers must arrive within this time. */
  http: { headersTimeout: 10_000 },
  /** Longer than the 60 s idle timeout that load balancers commonly use, so the balancer closes first. */
  keepAliveTimeout: 65_000,
  /** After this many requests on one connection the server asks the client to reconnect. */
  maxRequestsPerSocket: 1000,
  /** Bytes. A route that needs more (a webhook payload can reach 25 MB) raises it on that route only. */
  bodyLimit: 1_048_576,
} as const;

/**
 * Bytes. The body limit of the webhook route alone (E06-S02): 10 MiB, well under the 25 MB GitHub may send, so a
 * delivery that large is refused with `413` and never buffered. Every other route keeps {@link HTTP_LIMITS.bodyLimit}.
 */
export const WEBHOOK_BODY_LIMIT = 10_485_760;
