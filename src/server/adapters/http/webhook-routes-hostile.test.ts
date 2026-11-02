// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { LightMyRequestResponse } from 'fastify';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import {
  GITHUB_EXAMPLE,
  postDelivery,
  SECRET_CURRENT,
  SECRET_PREVIOUS,
  signCurrent,
  signUnconfigured,
  webhookTestApp,
} from './test-support.ts';

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_WEBHOOK_SECRET_PREVIOUS: SECRET_PREVIOUS };
const PAYLOAD = '{"action":"opened","number":7,"pull_request":{"number":7}}';
const GOOD = signCurrent(PAYLOAD);
const FLIPPED = Buffer.from(PAYLOAD);
FLIPPED[10] = (FLIPPED[10] ?? 0) ^ 0x01;

const REFUSED = [
  { label: 'one flipped byte in the body', body: FLIPPED, signature: GOOD },
  {
    label: 're-serialised JSON with different whitespace',
    body: JSON.stringify(JSON.parse(PAYLOAD), null, 2),
    signature: GOOD,
  },
  { label: 'a trailing newline added to the body', body: `${PAYLOAD}\n`, signature: GOOD },
  { label: 'the body cut short', body: PAYLOAD.slice(0, -1), signature: GOOD },
  { label: 'the signature of another delivery', body: PAYLOAD, signature: signCurrent(`${PAYLOAD} `) },
  { label: 'the signature of the empty string on a body', body: PAYLOAD, signature: signCurrent('') },
  { label: 'upper-case hex', body: PAYLOAD, signature: `sha256=${GOOD.slice(7).toUpperCase()}` },
  { label: 'a trailing space in the header', body: PAYLOAD, signature: `${GOOD} ` },
  { label: 'a leading space in the header', body: PAYLOAD, signature: ` ${GOOD}` },
  { label: 'a body signed by neither secret', body: PAYLOAD, signature: signUnconfigured(PAYLOAD) },
  { label: 'the legacy sha1 prefix', body: PAYLOAD, signature: `sha1=${GOOD.slice(7)}` },
  { label: 'no prefix', body: PAYLOAD, signature: GOOD.slice(7) },
  { label: 'a 63 digit signature', body: PAYLOAD, signature: GOOD.slice(0, -1) },
  { label: 'a 65 digit signature', body: PAYLOAD, signature: `${GOOD}0` },
  { label: 'a non-hex digit', body: PAYLOAD, signature: `${GOOD.slice(0, -1)}z` },
  { label: 'an empty header', body: PAYLOAD, signature: '' },
  { label: 'the digits of GitHub documented example', body: PAYLOAD, signature: GITHUB_EXAMPLE.signature },
];

/** Everything a client can see of a response but its request id, which is different every time. */
function answer(response: LightMyRequestResponse): string {
  const { error } = errorResponseSchema.parse(response.json());
  return JSON.stringify({
    status: response.statusCode,
    type: response.headers['content-type'],
    error: { ...error, requestId: '' },
  });
}

test.each(REFUSED)('$label is a 401 with the one standard body', async ({ body, signature }) => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await postDelivery(app, body, {
    'content-type': 'application/json',
    'x-hub-signature-256': signature,
  });
  expect(response.statusCode).toBe(401);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: { code: 'webhook_signature_invalid', message: 'Unauthorized', requestId: response.headers['x-request-id'] },
  });
  expect(Object.keys(response.json<{ error: object }>().error)).toEqual(['code', 'message', 'requestId']);
});

test('every cause of a refusal gives the same status, headers and body, apart from the request id', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const answers = await Promise.all(
    REFUSED.map(async ({ body, signature }) => {
      const response = await postDelivery(app, body, {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      });
      return answer(response);
    }),
  );
  const missing = await postDelivery(app, PAYLOAD, { 'content-type': 'application/json' });
  answers.push(answer(missing));
  expect(new Set(answers).size).toBe(1);
});

test('GET on the webhook path is a plain 404, not a signature failure', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await app.inject({ method: 'GET', url: WEBHOOK_PATH });
  expect(response.statusCode).toBe(404);
});
