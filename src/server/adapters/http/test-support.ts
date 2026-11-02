// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { onTestFinished, vi } from 'vitest';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { type TestAppOptions, testApp, UNREACHABLE_DATABASE_URL } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';

/**
 * The real app on a database that is never queried: the webhook route reads none before S06, so a test of it need not
 * pay for a PGlite. Closed after the test like {@link testApp}.
 */
export function webhookTestApp(options: Omit<TestAppOptions, 'db'> = {}) {
  return testApp({
    ...options,
    db: createPgDatabase({ connectionString: UNREACHABLE_DATABASE_URL, onError: vi.fn() }),
  });
}

/** GitHub's documented example for `X-Hub-Signature-256` (the secret, the payload and the header it yields). */
export const GITHUB_EXAMPLE = {
  secret: "It's a Secret to Everybody",
  body: 'Hello, World!',
  signature: 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
} as const;

/** Two made-up secrets of the length the configuration demands: the one in force and the one being retired. */
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up value for the tests, not a credential
export const SECRET_CURRENT = 'current-webhook-secret-0001';
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up value for the tests, not a credential
export const SECRET_PREVIOUS = 'previous-webhook-secret-002';

/** What GitHub sends in `X-Hub-Signature-256` for `body`, signed with `secret`. */
export function sign(secret: string, body: Buffer | string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** What GitHub's legacy `X-Hub-Signature` header would hold: an HMAC-SHA1, which the server must never accept. */
export function signLegacy(secret: string, body: Buffer | string): string {
  return `sha1=${crypto.createHmac('sha1', secret).update(body).digest('hex')}`;
}

/** A spy on `crypto.timingSafeEqual` that calls through and is removed when the test ends. */
export function watchTimingSafeEqual() {
  const spy = vi.spyOn(crypto, 'timingSafeEqual');
  onTestFinished(() => {
    spy.mockRestore();
  });
  return spy;
}

/** A spy on `crypto.createHmac` that calls through and is removed when the test ends. */
export function watchCreateHmac() {
  const spy = vi.spyOn(crypto, 'createHmac');
  onTestFinished(() => {
    spy.mockRestore();
  });
  return spy;
}

/** The headers of a delivery as GitHub sends them: JSON, signed with `secret` unless `signature` is given. */
export function deliveryHeaders(
  body: Buffer | string,
  options: { readonly secret?: string; readonly signature?: string } = {},
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-hub-signature-256': options.signature ?? sign(options.secret ?? SECRET_CURRENT, body),
  };
}

/** Posts `body` to the webhook route, signed with the current secret unless `headers` say otherwise. */
export function postDelivery(
  app: FastifyInstance,
  body: Buffer | string,
  headers: Record<string, string> = deliveryHeaders(body),
) {
  return app.inject({ method: 'POST', url: WEBHOOK_PATH, headers, payload: body });
}
