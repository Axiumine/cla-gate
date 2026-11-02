// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { PassThrough } from 'node:stream';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { captureLogs, freePort, PUBLIC_ROUTE, sendRaw, testApp, testConfig } from '../../test-support.ts';
import { frameworkErrorHandlers } from './framework-errors.ts';
import { createLogger } from './logger.ts';

/** The headers of the rate limit (E10-S08): a request that fails before routing never reaches the limiter, so its answer has none. */
const RATE_LIMIT = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];
const NOT_SECURITY = new Set([
  'content-type',
  'content-length',
  'date',
  'connection',
  'keep-alive',
  'x-request-id',
  ...RATE_LIMIT,
]);

/** The headers helmet adds: everything but the body's own headers and the request id. */
const securityOf = (headers: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !NOT_SECURITY.has(name)));

test.each([
  ['an invalid percent escape', '/%ZZ', { status: 400, code: 'bad_request', message: 'Bad Request' }],
  ['a lone percent sign', '/%', { status: 400, code: 'bad_request', message: 'Bad Request' }],
  [
    'a parameter longer than the router allows',
    `/long/${'a'.repeat(101)}`,
    { status: 414, code: 'uri_too_long', message: 'URI Too Long' },
  ],
])('%s gets the standard error body, a request id and the security headers', async (_case, url, expected) => {
  const { app, logs } = await testApp();
  app.get('/long/:id', PUBLIC_ROUTE, () => 'ok');
  const normal = await app.inject('/healthz');
  const response = await app.inject({ url, headers: { 'x-request-id': 'trace-abc-123' } });
  expect(response.statusCode).toBe(expected.status);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: { code: expected.code, message: expected.message, requestId: 'trace-abc-123' },
  });
  expect(response.headers['x-request-id']).toBe('trace-abc-123');
  expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(securityOf(response.headers)).toEqual(securityOf(normal.headers));
  // Nothing the probe response of the security headers carried (a date, a connection) leaks into the answer.
  expect(new Set(Object.keys(response.headers))).toEqual(
    new Set(Object.keys(normal.headers).filter((name) => !RATE_LIMIT.includes(name))),
  );
  expect(response.body).not.toMatch(/FST_ERR|not a valid url|exceeding|%ZZ|aaaa/);
  expect(logs.lines().find((line) => line['msg'] === 'request rejected')).toMatchObject({
    statusCode: expected.status,
  });
});

test('behind an https public URL the framework errors carry HSTS as well', async () => {
  const { app } = await testApp({ env: { PUBLIC_BASE_URL: 'https://cla.example.org' } });
  const response = await app.inject('/%ZZ');
  expect(response.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
});

test.each([
  ['garbage that is not HTTP', 'GARBAGE\r\n\r\n', 'HTTP/1.1 400 Bad Request', 'bad_request'],
  [
    'headers over the size limit',
    `GET /healthz HTTP/1.1\r\nHost: x\r\nX-Big: ${'a'.repeat(20_000)}\r\n\r\n`,
    'HTTP/1.1 431 Request Header Fields Too Large',
    'request_header_fields_too_large',
  ],
])(
  '%s is answered with the standard body and the security headers, then the connection closes',
  async (_case, text, statusLine, code) => {
    const { app } = await testApp();
    const address = await app.listen({ host: '127.0.0.1', port: await freePort() });
    const normal = await app.inject('/healthz');
    const raw = await sendRaw(address, text);
    expect(raw.statusLine).toBe(statusLine);
    const body = errorResponseSchema.parse(JSON.parse(raw.body));
    expect(body.error.code).toBe(code);
    expect(body.error.requestId).toBe(raw.headers['x-request-id']);
    expect(raw.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(raw.headers['content-length']).toBe(String(Buffer.byteLength(raw.body)));
    expect(raw.headers['connection']).toBe('close');
    expect(securityOf(raw.headers)).toEqual(securityOf(normal.headers));
    // The answer is written by hand: its fields are the security headers, the id, the body's own and nothing else.
    expect(new Set(Object.keys(raw.headers))).toEqual(
      new Set([
        ...Object.keys(securityOf(normal.headers)),
        'connection',
        'content-length',
        'content-type',
        'x-request-id',
      ]),
    );
  },
);

async function handler() {
  const { clientErrorHandler } = await frameworkErrorHandlers(testConfig(), createLogger({ logLevel: 'silent' }));
  return clientErrorHandler;
}

test.each([
  ['a request that took too long', 'ERR_HTTP_REQUEST_TIMEOUT', 'HTTP/1.1 408 Request Timeout'],
  ['an oversized header', 'HPE_HEADER_OVERFLOW', 'HTTP/1.1 431 Request Header Fields Too Large'],
  ['any other parse error', 'HPE_INVALID_METHOD', 'HTTP/1.1 400 Bad Request'],
  ['an error without a code', undefined, 'HTTP/1.1 400 Bad Request'],
])('%s is answered with the matching status and the socket is destroyed', async (_case, code, statusLine) => {
  const socket = new PassThrough();
  const written: string[] = [];
  socket.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));
  socket.on('error', () => undefined);
  (await handler())(Object.assign(new Error('parse'), code === undefined ? {} : { code }), socket);
  await new Promise((resolve) => socket.on('close', resolve));
  expect(written.join('')).toContain(statusLine);
  expect(socket.destroyed).toBe(true);
});

test('a reset connection and a socket that is already gone get no answer', async () => {
  const reset = new PassThrough();
  const gone = new PassThrough();
  gone.destroy();
  (await handler())(Object.assign(new Error('reset'), { code: 'ECONNRESET' }), reset);
  (await handler())(new Error('late'), gone);
  expect(reset.destroyed).toBe(false);
  expect(reset.readableLength).toBe(0);
  expect(gone.readableLength).toBe(0);
});

test('a socket that cannot be written to is destroyed without a write', async () => {
  const closing = new PassThrough();
  const errors: string[] = [];
  closing.on('error', (error) => errors.push(error.message));
  closing.end();
  (await handler())(new Error('half closed'), closing);
  await new Promise((resolve) => closing.on('close', resolve));
  expect(closing.destroyed).toBe(true);
  expect(closing.readableLength).toBe(0);
  // Only the error that ended the connection: a write after the end would add one of its own.
  expect(errors).toEqual(['half closed']);
});

test('a rejected connection is logged at trace level with the error', async () => {
  const logs = captureLogs();
  const { clientErrorHandler } = await frameworkErrorHandlers(
    testConfig(),
    createLogger({ logLevel: 'trace' }, logs.destination),
  );
  const socket = new PassThrough();
  socket.on('error', () => undefined);
  clientErrorHandler(Object.assign(new Error('parse'), { code: 'HPE_INVALID_METHOD' }), socket);
  await new Promise((resolve) => socket.on('close', resolve));
  expect(logs.lines()).toMatchObject([
    { level: 10, msg: 'client error', err: { type: 'Error', code: 'HPE_INVALID_METHOD' } },
  ]);
});
