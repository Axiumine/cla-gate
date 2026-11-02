// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { freePort, sendRaw } from '../../test-support.ts';
import { WEBHOOK_BODY_LIMIT } from './limits.ts';
import { deliveryHeaders, GITHUB_HEADER_LINES, rawPost, SECRET_CURRENT, sign, webhookTestApp } from './test-support.ts';

// These tests write the request to a real loopback socket, on a random port from 32769 to 60999 (docs/ci-runners.md),
// so repeated headers, a declared length and chunked framing are what Node's HTTP parser makes of them.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
const BODY = Buffer.from('{"action":"opened"}');
const SIGNATURE = `X-Hub-Signature-256: ${sign(SECRET_CURRENT, BODY)}`;
const JSON_TYPE = 'Content-Type: application/json';
const [EVENT, DELIVERY] = GITHUB_HEADER_LINES;

async function listening(): Promise<string> {
  const { app } = await webhookTestApp({ env: ENV });
  return app.listen({ host: '127.0.0.1', port: await freePort() });
}

function codeOf(body: string): string {
  return errorResponseSchema.parse(JSON.parse(body)).error.code;
}

test('one event header and one delivery header are accepted, with a charset on the content type', async () => {
  const address = await listening();
  const lines = ['Content-Type: application/json; charset=utf-8', EVENT, DELIVERY, SIGNATURE];
  expect((await sendRaw(address, rawPost(lines, BODY))).statusLine).toBe('HTTP/1.1 200 OK');
});

test('a repeated X-GitHub-Event header is a 400, even when both copies are the same valid value', async () => {
  const address = await listening();
  const answer = await sendRaw(address, rawPost([JSON_TYPE, EVENT, EVENT, DELIVERY, SIGNATURE], BODY));
  expect(answer.statusLine).toBe('HTTP/1.1 400 Bad Request');
  expect(codeOf(answer.body)).toBe('webhook_header_invalid');
  const different = await sendRaw(
    address,
    rawPost([JSON_TYPE, EVENT, 'X-GitHub-Event: issue_comment', DELIVERY, SIGNATURE], BODY),
  );
  expect(codeOf(different.body)).toBe('webhook_header_invalid');
});

test('a repeated X-GitHub-Delivery header is a 400', async () => {
  const address = await listening();
  const answer = await sendRaw(address, rawPost([JSON_TYPE, EVENT, DELIVERY, DELIVERY, SIGNATURE], BODY));
  expect(answer.statusLine).toBe('HTTP/1.1 400 Bad Request');
  expect(codeOf(answer.body)).toBe('webhook_header_invalid');
});

test('a repeated header on an unsigned request is still a 401: the header check comes after the signature', async () => {
  const address = await listening();
  const unsigned = `X-Hub-Signature-256: sha256=${'0'.repeat(64)}`;
  const answer = await sendRaw(address, rawPost([JSON_TYPE, EVENT, EVENT, DELIVERY, unsigned], BODY));
  expect(answer.statusLine).toBe('HTTP/1.1 401 Unauthorized');
});

test('a form-encoded body with a valid signature is a 415, and without one a 401', async () => {
  const address = await listening();
  const form = Buffer.from(`payload=${encodeURIComponent(BODY.toString('utf8'))}`);
  const type = 'Content-Type: application/x-www-form-urlencoded';
  const signed = `X-Hub-Signature-256: ${sign(SECRET_CURRENT, form)}`;
  const accepted = await sendRaw(address, rawPost([type, EVENT, DELIVERY, signed], form));
  const refused = await sendRaw(address, rawPost([type, EVENT, DELIVERY, SIGNATURE], form));
  expect(accepted.statusLine).toBe('HTTP/1.1 415 Unsupported Media Type');
  expect(codeOf(accepted.body)).toBe('webhook_unsupported_media_type');
  expect(refused.statusLine).toBe('HTTP/1.1 401 Unauthorized');
});

test('a declared length over the limit is a 413 at once: the body is not waited for, let alone buffered', async () => {
  const address = await listening();
  const lines = [JSON_TYPE, EVENT, DELIVERY, SIGNATURE];
  // Only 19 bytes are sent: a server that waited for the other 10 MiB would hang until the request timeout.
  const answer = await sendRaw(address, rawPost(lines, BODY, WEBHOOK_BODY_LIMIT + 1));
  expect(answer.statusLine).toBe('HTTP/1.1 413 Payload Too Large');
  expect(codeOf(answer.body)).toBe('webhook_payload_too_large');
});

test('a chunked body past the limit is a 413 and is never concatenated past the limit', async () => {
  const address = await listening();
  const joined: number[] = [];
  const original = Buffer.concat.bind(Buffer);
  const concat = vi.spyOn(Buffer, 'concat').mockImplementation((list, length) => {
    const whole = original(list, length);
    joined.push(whole.length);
    return whole;
  });
  onTestFinished(() => {
    concat.mockRestore();
  });
  const chunk = Buffer.alloc(1024 * 1024, 0x61);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent > WEBHOOK_BODY_LIMIT / chunk.length + 1) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  const response = await fetch(`${address}${WEBHOOK_PATH}`, {
    method: 'POST',
    headers: deliveryHeaders(chunk),
    body,
    duplex: 'half',
  });
  expect(response.status).toBe(413);
  expect(codeOf(await response.text())).toBe('webhook_payload_too_large');
  expect(Math.max(0, ...joined)).toBeLessThanOrEqual(WEBHOOK_BODY_LIMIT);
});
