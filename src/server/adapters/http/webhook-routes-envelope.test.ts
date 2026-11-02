// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  deliveryHeaders,
  postDelivery,
  SECRET_CURRENT,
  sign,
  signCurrent,
  signUnconfigured,
  webhookTestApp,
} from './test-support.ts';

const APP_ID = '123456';
const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: APP_ID };
const PAYLOAD = '{"action":"opened","number":7}';
const BROKEN = '{"action":';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const WRONG_APP = { 'x-github-hook-installation-target-id': '654321' };
const BAD_EVENT = { 'x-github-event': 'Pull-Request' };
const BAD_SIGNATURE = signUnconfigured(PAYLOAD);

// Each row breaks several rules at once; the status is the first of the fixed order that the request breaks:
// size (413, in the oversize tests), signature (401), headers (400), media type (415), JSON (400).
const ORDER = [
  {
    label: 'unsigned, with every other rule broken too',
    body: BROKEN,
    headers: { ...BAD_EVENT, ...WRONG_APP, ...FORM },
    signature: BAD_SIGNATURE,
    status: 401,
    code: 'webhook_signature_invalid',
  },
  {
    label: 'signed, with a bad event header and every later rule broken too',
    body: BROKEN,
    headers: { ...BAD_EVENT, ...WRONG_APP, ...FORM },
    status: 400,
    code: 'webhook_header_invalid',
  },
  {
    label: 'signed, with the wrong App and every later rule broken too',
    body: BROKEN,
    headers: { ...WRONG_APP, ...FORM },
    status: 400,
    code: 'webhook_wrong_app',
  },
  {
    label: 'signed, with a form body that is not JSON either',
    body: BROKEN,
    headers: FORM,
    status: 415,
    code: 'webhook_unsupported_media_type',
  },
  {
    label: 'signed, with everything right but the JSON',
    body: BROKEN,
    headers: {},
    status: 400,
    code: 'webhook_payload_invalid',
  },
  { label: 'signed, with everything right', body: PAYLOAD, headers: {}, status: 200, code: undefined },
];

test.each(ORDER)('$label gives $status', async ({ body, headers, signature, status, code }) => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await postDelivery(app, body, deliveryHeaders(body, { signature, headers }));
  expect(response.statusCode).toBe(status);
  if (code !== undefined) {
    expect(errorResponseSchema.parse(response.json()).error.code).toBe(code);
  }
});

const FAILURES = [
  {
    label: 'a bad header',
    headers: BAD_EVENT,
    status: 400,
    message: 'Bad Request',
    details: { header: 'X-GitHub-Event' },
  },
  { label: 'the wrong App', headers: WRONG_APP, status: 400, message: 'Bad Request', details: undefined },
  { label: 'a form body', headers: FORM, status: 415, message: 'Unsupported Media Type', details: undefined },
];

test.each(FAILURES)(
  '$label is the standard error body: the status text as message, details only as built',
  async ({ headers, status, message, details }) => {
    const { app } = await webhookTestApp({ env: ENV });
    const response = await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { headers }));
    expect(response.statusCode).toBe(status);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    const { error } = errorResponseSchema.parse(response.json());
    expect(error).toMatchObject({ message, requestId: response.headers['x-request-id'] });
    if (details !== undefined) {
      expect(error.details).toEqual(details);
    }
  },
);

test('the 415 tells the operator to set the content type to application/json in the App settings', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { headers: FORM }));
  expect(errorResponseSchema.parse(response.json()).error.details).toEqual({
    hint: 'Set the webhook content type to application/json in the GitHub App settings.',
  });
});

test('the wrong-App refusal says the webhook secret is shared with another App', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { headers: WRONG_APP }));
  const { details } = errorResponseSchema.parse(response.json()).error;
  expect(JSON.stringify(details)).toContain('webhook secret is shared');
});

test('a delivery for this App, by target id and type, passes', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const headers = {
    'x-github-hook-installation-target-id': APP_ID,
    'x-github-hook-installation-target-type': 'integration',
  };
  expect((await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { headers }))).statusCode).toBe(200);
});

test('a target id with no GITHUB_APP_ID configured is refused, and without a target id the delivery passes', async () => {
  const { app } = await webhookTestApp({ env: { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT } });
  const named = deliveryHeaders(PAYLOAD, { headers: { 'x-github-hook-installation-target-id': APP_ID } });
  expect((await postDelivery(app, PAYLOAD, named)).statusCode).toBe(400);
  expect((await postDelivery(app, PAYLOAD)).statusCode).toBe(200);
});

test('a target type other than integration is refused', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const headers = { 'x-github-hook-installation-target-type': 'repository' };
  const response = await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { headers }));
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_wrong_app');
});

test('the JSON parser does not run for a delivery refused before the JSON step', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const parse = vi.spyOn(JSON, 'parse');
  onTestFinished(() => {
    parse.mockRestore();
  });
  const refused = ORDER.filter(({ code }) => code !== undefined && code !== 'webhook_payload_invalid');
  expect(refused).toHaveLength(4);
  for (const { body, headers, signature } of refused) {
    await postDelivery(app, body, deliveryHeaders(body, { signature, headers }));
  }
  expect(parse).not.toHaveBeenCalled();
  // The control: the same spy does see the parse of a delivery that gets as far as the JSON step.
  await postDelivery(app, PAYLOAD);
  expect(parse).toHaveBeenCalledTimes(1);
});

test('no part of a body or a header value reaches a response or the log, whatever the refusal', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const canary = 'canary-5f3d9a1c7b2e';
  const body = `{"leak":"${canary}",`;
  const bodies: string[] = [];
  const requests = [
    { headers: { 'x-github-event': `Event-${canary}` } },
    { headers: { 'x-github-delivery': `delivery-${canary}` } },
    { headers: { 'x-github-hook-installation-target-id': canary } },
    { headers: { 'x-github-hook-installation-target-type': canary } },
    { headers: { 'content-type': `text/${canary}` } },
    { headers: {} },
    { headers: {}, signature: sign(canary.padEnd(16, 'x'), body) },
  ];
  for (const { headers, signature } of requests) {
    const sent = deliveryHeaders(body, { headers, ...(signature === undefined ? {} : { signature }) });
    bodies.push((await postDelivery(app, body, sent)).body);
  }
  const everything = `${logs.text()}\n${bodies.join('\n')}`;
  expect(everything).not.toContain(canary);
  expect(everything).not.toContain(signCurrent(body).slice(7));
  expect(everything).not.toContain('leak');
  expect(bodies.filter((text) => text.includes('webhook_'))).toHaveLength(requests.length);
});

test.each([
  { label: 'an empty value', type: '' },
  { label: 'a type with no subtype', type: 'application' },
  { label: 'a lone slash', type: '/' },
  { label: 'three parts', type: 'a/b/c' },
  { label: 'only separators', type: ';' },
  { label: 'a control character', type: '\u0001' },
])('a Content-Type that is $label: unsigned it is a 401, signed it is the webhook 415', async ({ type }) => {
  const { app } = await webhookTestApp({ env: ENV });
  const unsigned = await postDelivery(
    app,
    PAYLOAD,
    deliveryHeaders(PAYLOAD, { signature: BAD_SIGNATURE, headers: { 'content-type': type } }),
  );
  const signed = await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { headers: { 'content-type': type } }));
  expect(errorResponseSchema.parse(unsigned.json()).error.code).toBe('webhook_signature_invalid');
  expect(errorResponseSchema.parse(signed.json()).error.code).toBe('webhook_unsupported_media_type');
  expect(unsigned.statusCode).toBe(401);
  expect(signed.statusCode).toBe(415);
});
