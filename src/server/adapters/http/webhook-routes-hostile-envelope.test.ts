// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { postDelivery, SECRET_CURRENT, webhookTestApp } from './test-support.ts';

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
const VALID = '{"action":"opened"}';

// Every body is signed with the current secret, so each one reaches the JSON step and is refused there.
const HOSTILE = [
  { label: 'a BOM prefix', body: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from(VALID)]) },
  {
    label: 'lone surrogate bytes',
    body: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d]),
  },
  { label: 'invalid UTF-8', body: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]) },
  { label: 'a NUL byte in a string', body: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0x00, 0x22, 0x7d]) },
  { label: 'a NUL byte after the object', body: Buffer.from([...Buffer.from(VALID), 0x00]) },
  { label: 'a NUL-only body', body: Buffer.alloc(16) },
  { label: '1 MiB of [ nesting', body: Buffer.alloc(1_048_576, 0x5b) },
  { label: '1 MiB of { nesting', body: Buffer.from('{"a":'.repeat(209_715)) },
  { label: 'a million brackets, closed', body: Buffer.from(`${'['.repeat(500_000)}${']'.repeat(500_000)}`) },
  { label: 'a top-level array', body: Buffer.from(`[${VALID}]`) },
  { label: 'a top-level null', body: Buffer.from('null') },
  { label: 'a top-level number', body: Buffer.from('7') },
  { label: 'a top-level string', body: Buffer.from(`"${VALID.replaceAll('"', '\\"')}"`) },
  { label: 'a top-level boolean', body: Buffer.from('false') },
  { label: 'the empty body', body: Buffer.alloc(0) },
  { label: 'a body that is only whitespace', body: Buffer.from(' \r\n\t ') },
];

test.each(HOSTILE)('$label is a 400 webhook_payload_invalid and the server keeps serving', async ({ body }) => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const response = await postDelivery(app, body);
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: { code: 'webhook_payload_invalid', message: 'Bad Request', requestId: response.headers['x-request-id'] },
  });
  expect(logs.text()).not.toContain('Unexpected');
  // Alive: the next valid delivery on the same server is accepted.
  expect((await postDelivery(app, VALID)).statusCode).toBe(200);
});

test('the log of a refused payload holds the code and the status, and nothing the parser said', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  await postDelivery(app, '{"secret-looking-key": nope}');
  const refusal = logs.lines().find((line) => line['msg'] === 'request rejected');
  expect(refusal).toMatchObject({ statusCode: 400, code: 'webhook_payload_invalid' });
  expect(logs.text()).not.toContain('secret-looking-key');
  expect(logs.text()).not.toContain('nope');
});
