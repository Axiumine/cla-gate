// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { freePort, sendRaw } from '../../test-support.ts';
import { deliveryHeaders, GITHUB_HEADER_LINES, rawPost, SECRET_CURRENT, sign, webhookTestApp } from './test-support.ts';

// These tests send the request over a real loopback socket, on a random port from 32769 to 60999 (docs/ci-runners.md),
// so the bytes the route verifies are the bytes a client wrote, through Node's HTTP parser.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
// CRLF line endings, odd spacing, a multi-byte character and an emoji: re-encoding any of it changes the bytes.
const PAYLOAD = Buffer.from('{\r\n  "action" : "opened",\r\n  "title": "Zażółć \u{1F600}"\r\n}\r\n', 'utf8');

async function listening(): Promise<string> {
  const { app } = await webhookTestApp({ env: ENV });
  return app.listen({ host: '127.0.0.1', port: await freePort() });
}

function post(address: string, body: Buffer, signature: string) {
  return fetch(`${address}${WEBHOOK_PATH}`, {
    method: 'POST',
    headers: deliveryHeaders(body, { signature }),
    body,
  });
}

test('bytes written to the socket are the bytes that were signed: CRLF, spacing and multi-byte text included', async () => {
  const address = await listening();
  const response = await post(address, PAYLOAD, sign(SECRET_CURRENT, PAYLOAD));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'verified' });
});

test('bytes that are not text are verified as bytes: signed, they pass the signature and fail as a payload', async () => {
  const address = await listening();
  // Invalid UTF-8, a NUL and the encoding of a lone surrogate: nothing a text decoder would hand back unchanged.
  const bytes = Buffer.from([0x7b, 0xff, 0xfe, 0x80, 0x00, 0xed, 0xa0, 0x80, 0x7d]);
  const signed = await post(address, bytes, sign(SECRET_CURRENT, bytes));
  expect(signed.status).toBe(400);
  expect(errorResponseSchema.parse(await signed.json()).error.code).toBe('webhook_payload_invalid');
  const unsigned = await post(address, bytes, sign(SECRET_CURRENT, 'something else'));
  expect(unsigned.status).toBe(401);
});

test('a body of 900 KiB arrives in many chunks and is verified as the whole it adds up to', async () => {
  const address = await listening();
  const big = Buffer.from(`{"padding":"${'a'.repeat(900 * 1024)}"}`);
  const response = await post(address, big, sign(SECRET_CURRENT, big));
  expect(response.status).toBe(200);
  const altered = Buffer.from(big);
  altered[altered.length - 3] = 0x62;
  expect((await post(address, altered, sign(SECRET_CURRENT, big))).status).toBe(401);
});

test('the same document written with other whitespace is refused over the socket', async () => {
  const address = await listening();
  const reformatted = Buffer.from(JSON.stringify(JSON.parse(PAYLOAD.toString('utf8'))), 'utf8');
  const response = await post(address, reformatted, sign(SECRET_CURRENT, PAYLOAD));
  expect(response.status).toBe(401);
  expect(errorResponseSchema.parse(await response.json()).error.code).toBe('webhook_signature_invalid');
});

test('a chunked body is verified as the whole it adds up to', async () => {
  const address = await listening();
  const half = Math.floor(PAYLOAD.length / 2);
  const chunks = [PAYLOAD.subarray(0, half), PAYLOAD.subarray(half)];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const response = await fetch(`${address}${WEBHOOK_PATH}`, {
    method: 'POST',
    headers: deliveryHeaders(PAYLOAD),
    body,
    duplex: 'half',
  });
  expect(response.status).toBe(200);
});

function rawRequest(headers: readonly string[], body: Buffer): string {
  return rawPost(['Content-Type: application/json', ...GITHUB_HEADER_LINES, ...headers], body);
}

test('a repeated signature header is refused even when each copy is correct', async () => {
  const address = await listening();
  const header = `X-Hub-Signature-256: ${sign(SECRET_CURRENT, '{"ok":true}')}`;
  const body = Buffer.from('{"ok":true}');
  const single = await sendRaw(address, rawRequest([header], body));
  const repeated = await sendRaw(address, rawRequest([header, header], body));
  expect(single.statusLine).toBe('HTTP/1.1 200 OK');
  expect(repeated.statusLine).toBe('HTTP/1.1 401 Unauthorized');
  expect(errorResponseSchema.parse(JSON.parse(repeated.body)).error.code).toBe('webhook_signature_invalid');
});

test('a request carrying only the legacy header is refused over the socket', async () => {
  const address = await listening();
  const body = Buffer.from('{"ok":true}');
  const answer = await sendRaw(
    address,
    rawRequest(['X-Hub-Signature: sha1=da39a3ee5e6b4b0d3255bfef95601890afd80709'], body),
  );
  expect(answer.statusLine).toBe('HTTP/1.1 401 Unauthorized');
});
