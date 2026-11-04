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

/**
 * Bytes. The body limit of the routes of the CLA documents that change data (E12-S02): 512 KiB. A text of the most bytes a
 * CLA may have (204 800, `CLA_TEXT_MAX_BYTES`) whose every character JSON escapes with two bytes (a quote, a backslash, a
 * line feed) is 409 600 bytes, so it fits with its envelope; a larger body is refused with `413` before it is parsed. The
 * limit is below {@link HTTP_LIMITS.bodyLimit}, which every other route keeps.
 */
export const CLA_BODY_LIMIT = 524_288;

/**
 * Bytes. The body limit of the setup routes (E19-S06): 4 KiB, far more than a token or the four answers of the manifest form
 * need, so a larger body is refused with `413` before it is parsed.
 */
export const SETUP_BODY_LIMIT = 4096;

/**
 * Bytes. The body limit of the sign request (E13-S04): 16 KiB. The body holds two ids, a hash, the id of a consent sentence, a name of
 * at most 200 code points once cleaned and one e-mail address; even a name of 200 astral characters that JSON escapes as two
 * `\uXXXX` sequences, with a long run of white space in it, fits many times over. A larger body is refused with `413` before it is
 * parsed, so a request from anybody, signed in or not, never makes the server read the 1 MiB of the other routes.
 */
export const SIGN_BODY_LIMIT = 16_384;
