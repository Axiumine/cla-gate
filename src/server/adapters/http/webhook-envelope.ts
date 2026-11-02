// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { AppError } from './errors.ts';

/** A delivery that passed the envelope checks: what the headers say, and the body as a JSON object. */
export interface WebhookEnvelope {
  /** The `X-GitHub-Event` header: lower-case letters and underscores, 64 characters at most. */
  readonly event: string;
  /** The `X-GitHub-Delivery` header, a UUID in lower case, the key a delivery is recorded under. */
  readonly deliveryId: string;
  /** The parsed body, still unchecked: the event schemas (E06-S03) decide what is in it. */
  readonly payload: Record<string, unknown>;
}

/** What GitHub names an event: `pull_request`, `check_run`, `ping`. Anything else is not an event this server routes. */
const eventHeader = z
  .string()
  .max(64)
  .regex(/^[a-z_]+$/);

/** A UUID in any version, as GitHub writes it; stored lower-case so one delivery never has two keys. */
const deliveryHeader = z.guid().transform((id) => id.toLowerCase());

const WRONG_APP_HINT =
  'This delivery was sent for another GitHub App: the webhook secret is shared with it. Give each App its own secret.';
const MEDIA_TYPE_HINT = 'Set the webhook content type to application/json in the GitHub App settings.';

function invalidHeader(name: string): AppError {
  return new AppError(400, 'webhook_header_invalid', { header: name });
}

/**
 * The two headers every delivery carries (E06-S02). A missing, malformed or repeated one is a `400`
 * `webhook_header_invalid` naming the header, never its value: Node joins a repeated header with a comma, which
 * neither pattern accepts, and a value that is not one string (an array) matches nothing.
 */
function readDeliveryHeaders(headers: IncomingHttpHeaders): Pick<WebhookEnvelope, 'event' | 'deliveryId'> {
  const event = eventHeader.safeParse(headers['x-github-event']);
  if (!event.success) {
    throw invalidHeader('X-GitHub-Event');
  }
  const deliveryId = deliveryHeader.safeParse(headers['x-github-delivery']);
  if (!deliveryId.success) {
    throw invalidHeader('X-GitHub-Delivery');
  }
  return { event: event.data, deliveryId: deliveryId.data };
}

/**
 * The headers GitHub adds to the delivery of a GitHub App say which App it was sent for. When present they must name
 * this one: the signature proves GitHub sent the delivery, not that it was meant for this server, and a secret shared
 * with another App would otherwise be enough. With no `GITHUB_APP_ID` configured a present target id matches nothing.
 */
function requireThisApp(headers: IncomingHttpHeaders, appId: string | undefined): void {
  const targetId = headers['x-github-hook-installation-target-id'];
  const targetType = headers['x-github-hook-installation-target-type'];
  const otherApp = targetId !== undefined && !(typeof targetId === 'string' && targetId === appId);
  const otherKind = targetType !== undefined && targetType !== 'integration';
  if (otherApp || otherKind) {
    throw new AppError(400, 'webhook_wrong_app', { hint: WRONG_APP_HINT });
  }
}

/**
 * GitHub offers `application/json` and `application/x-www-form-urlencoded` (the JSON wrapped in a `payload` field).
 * Only the first is accepted, with any parameters (`charset=utf-8`): the signed bytes of a form body are not the JSON.
 */
function requireJsonMediaType(contentType: string | undefined): void {
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new AppError(415, 'webhook_unsupported_media_type', { hint: MEDIA_TYPE_HINT });
  }
}

/** Fatal on invalid UTF-8, and a byte order mark is kept in the text, so `JSON.parse` refuses it. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * UTF-8 with fatal errors, then JSON, and the top-level value must be an object: invalid bytes, invalid syntax, an
 * array, `null`, a number and a string are all the same `400` `webhook_payload_invalid`. Nothing of the body or of the
 * parser's message (it quotes the text) is kept in the error.
 */
function parseJsonObject(body: Buffer): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(UTF8.decode(body));
  } catch {
    throw new AppError(400, 'webhook_payload_invalid');
  }
  if (!isJsonObject(value)) {
    throw new AppError(400, 'webhook_payload_invalid');
  }
  return value;
}

/**
 * The checks of a signed delivery after the body limit and the signature (E06-S02), in the fixed order: the headers
 * (`400`), the media type (`415`), the JSON syntax and shape (`400`). The first failure is thrown as an
 * {@link AppError}; nothing runs for a request the signature refused, because this is called only after it.
 *
 * @param appId the configured `GITHUB_APP_ID`
 */
export function readEnvelope(headers: IncomingHttpHeaders, body: Buffer, appId: string | undefined): WebhookEnvelope {
  const ids = readDeliveryHeaders(headers);
  requireThisApp(headers, appId);
  requireJsonMediaType(headers['content-type']);
  return { ...ids, payload: parseJsonObject(body) };
}
