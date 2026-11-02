// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { onTestFinished, vi } from 'vitest';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { tenantDatabase } from '../../services/tenant-fixture/test-support.ts';
import { type TestAppOptions, testApp, UNREACHABLE_DATABASE_URL } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import { readEnvelope, type WebhookEnvelope } from './webhook-envelope.ts';

/** A database handle that never reaches a server (nothing connects until a query runs, and then it is refused). The caller closes it. */
export function unreachableDatabase(): Kysely<Database> {
  return createPgDatabase({ connectionString: UNREACHABLE_DATABASE_URL, onError: vi.fn() });
}

/**
 * The real app on a database that is never reached: a delivery that is refused or ignored before the tenant filter
 * (E06-S05) reads none, so a test of those need not pay for a PGlite, and one that does reach it fails with a refused
 * connection. Closed after the test like {@link testApp}.
 */
export function webhookTestApp(options: Omit<TestAppOptions, 'db'> = {}) {
  return testApp({ ...options, db: unreachableDatabase() });
}

/**
 * {@link webhookTestApp} over a database that holds the tenants of the tenant filter (E06-S05), for the deliveries that
 * name one: the admitted one is the tenant of the webhook fixtures, so an unchanged fixture is a delivery the instance serves.
 */
export async function tenantWebhookApp(options: Omit<TestAppOptions, 'db'> = {}) {
  return testApp({ ...options, db: await tenantDatabase() });
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

/** The delivery id the tests send unless they say otherwise: a UUID, as GitHub's are. */
const DELIVERY_ID = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';

/**
 * The headers of a delivery as GitHub sends them: JSON, signed with `secret` unless `signature` is given, an event and
 * a delivery id. `headers` adds to or replaces those (a value of `undefined` removes the header).
 */
export function deliveryHeaders(
  body: Buffer | string,
  options: {
    readonly secret?: string;
    readonly signature?: string | undefined;
    readonly headers?: Readonly<Record<string, string | undefined>>;
  } = {},
): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    'content-type': 'application/json',
    'x-hub-signature-256': options.signature ?? sign(options.secret ?? SECRET_CURRENT, body),
    // `ping` has no payload schema (E06-S03), so a test that is about the envelope may send any JSON object.
    'x-github-event': 'ping',
    'x-github-delivery': DELIVERY_ID,
    ...options.headers,
  };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** What `run` throws, or `undefined` when it returns: for the tests that look at the error itself. */
export function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** What a payload that fails its schema is refused with (E06-S03): a `400` whose details are the failed `paths`. */
export function payloadInvalid(paths: readonly string[]) {
  return { status: 400, code: 'webhook_payload_invalid', details: { paths } };
}

/** A logger for the code that is given one: it keeps the calls to `info`. */
export function recordingLog() {
  return { info: vi.fn<(fields: unknown, message?: string) => void>() };
}

/** The envelope of a delivery of `event` with `body`, as the route has it once the checks of E06-S02 passed: for the tests of what comes after them. */
export function envelopeOf(event: string, body: Buffer | string): WebhookEnvelope {
  const headers = { 'x-github-event': event, 'x-github-delivery': DELIVERY_ID, 'content-type': 'application/json' };
  return readEnvelope(headers, Buffer.from(body), undefined);
}

/** The header lines of a raw HTTP request that carry the event and the delivery id, for tests that write the request by hand. */
export const GITHUB_HEADER_LINES = ['X-GitHub-Event: ping', `X-GitHub-Delivery: ${DELIVERY_ID}`] as const;

/**
 * A whole HTTP/1.1 `POST` to the webhook route as text, for {@link sendRaw}: `headerLines` are written as they are (so a
 * header can be repeated), `body` goes out byte for byte (Latin-1), and `declaredLength` is the `Content-Length` when
 * it should differ from the body's.
 */
export function rawPost(headerLines: readonly string[], body: Buffer, declaredLength = body.length): string {
  return [
    `POST ${WEBHOOK_PATH} HTTP/1.1`,
    'Host: 127.0.0.1',
    `Content-Length: ${declaredLength}`,
    ...headerLines,
    'Connection: close',
    '',
    body.toString('latin1'),
  ].join('\r\n');
}

/** Posts `body` to the webhook route, signed with the current secret unless `headers` say otherwise. */
export function postDelivery(
  app: FastifyInstance,
  body: Buffer | string,
  headers: Record<string, string> = deliveryHeaders(body),
) {
  return app.inject({ method: 'POST', url: WEBHOOK_PATH, headers, payload: body });
}
