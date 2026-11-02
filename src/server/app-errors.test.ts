// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { STATUS_CODES } from 'node:http';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from '../shared/errors.ts';
import { authWorld } from './adapters/http/auth-fixture/test-support.ts';
import { PUBLIC_ROUTE, testApp } from './test-support.ts';

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up message: the test proves that an exception message never reaches the response
const SECRET_MESSAGE = 'connect to db.internal:5432 failed, password=hunter2';

async function withRoutes() {
  const test_ = await testApp();
  const { app } = test_;
  app.get('/boom', PUBLIC_ROUTE, () => {
    throw new Error(SECRET_MESSAGE);
  });
  app.get('/conflict', PUBLIC_ROUTE, () => {
    throw Object.assign(new Error('internal conflict details'), { statusCode: 409 });
  });
  app.get('/teapot-as-500', PUBLIC_ROUTE, () => {
    throw Object.assign(new Error('weird status'), { statusCode: 599 });
  });
  app.get('/below-client-errors', PUBLIC_ROUTE, () => {
    throw Object.assign(new Error('a redirect status on an error'), { statusCode: 302 });
  });
  app.get('/validation-without-status', PUBLIC_ROUTE, () => {
    // The marker fastify-type-provider-zod puts on every validation issue it creates (Symbol.for, a global registry).
    const issue = {
      [Symbol.for('ZodFastifySchemaValidationError')]: true,
      keyword: 'zod',
      instancePath: '',
      schemaPath: '#',
    };
    throw Object.assign(new Error('validation details'), { validation: [issue] });
  });
  app.get('/unnamed-status', PUBLIC_ROUTE, () => {
    throw Object.assign(new Error('no standard text for this status'), { statusCode: 499 });
  });
  app.get('/string', PUBLIC_ROUTE, () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercises the path for a thrown value that is not an Error
    throw 'a plain string with hunter2';
  });
  app.post(
    '/echo',
    { ...PUBLIC_ROUTE, schema: { body: z.object({ name: z.string().min(1) }) } },
    (request) => request.body,
  );
  return test_;
}

test('an unexpected error becomes a generic 500 and its details go to the log only', async () => {
  const { app, logs } = await withRoutes();
  const response = await app.inject('/boom');
  expect(response.statusCode).toBe(500);
  const body = errorResponseSchema.parse(response.json());
  expect(body.error).toEqual({
    code: 'internal_server_error',
    message: 'Internal Server Error',
    requestId: response.headers['x-request-id'],
  });
  expect(response.body).not.toMatch(/hunter2|db\.internal|stack|at /);
  const logged = logs.lines().find((line) => line['msg'] === 'unhandled error');
  expect(logged).toMatchObject({ level: 50, err: { type: 'Error', message: SECRET_MESSAGE } });
});

test('a client error keeps its status but not its message', async () => {
  const { app, logs } = await withRoutes();
  const response = await app.inject('/conflict');
  expect(response.statusCode).toBe(409);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({ code: 'conflict', message: 'Conflict' });
  expect(response.body).not.toContain('internal conflict details');
  expect(logs.lines().find((line) => line['msg'] === 'request rejected')).toMatchObject({ statusCode: 409 });
});

test('a client error status without a standard text falls back to a plain Error', async () => {
  const { app } = await withRoutes();
  const response = await app.inject('/unnamed-status');
  expect(response.statusCode).toBe(499);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({ code: 'error', message: 'Error' });
  expect(response.body).not.toContain('no standard text');
});

test.each([
  ['a status outside 4xx', '/teapot-as-500'],
  ['a status below 400', '/below-client-errors'],
  ['a thrown string', '/string'],
])('%s is a 500', async (_label, url) => {
  const { app } = await withRoutes();
  const response = await app.inject(url);
  expect(response.statusCode).toBe(500);
  expect(response.body).not.toContain('hunter2');
});

test('a body that fails validation is a generic 400 that echoes nothing and logs no body', async () => {
  const { app, logs } = await withRoutes();
  const response = await app.inject({
    method: 'POST',
    url: '/echo',
    payload: { name: '', other: 'body-secret-value' },
  });
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({
    code: 'bad_request',
    message: 'Bad Request',
  });
  expect(response.body).not.toMatch(/name|body-secret-value|issue|expected/);
  expect(logs.text()).not.toContain('body-secret-value');
});

test('a validation error that carries no status of its own is still a generic 400', async () => {
  const { app } = await withRoutes();
  const response = await app.inject('/validation-without-status');
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({
    code: 'bad_request',
    message: 'Bad Request',
  });
  expect(response.body).not.toContain('validation details');
});

test('a valid body passes validation, for a caller the state-changing guard lets through (E10-S03)', async () => {
  const { app, login } = await authWorld();
  app.post(
    '/echo',
    { ...PUBLIC_ROUTE, schema: { body: z.object({ name: z.string().min(1) }) } },
    (request) => request.body,
  );
  const alice = await login(1001);
  const response = await app.inject({ method: 'POST', url: '/echo', headers: alice.headers, payload: { name: 'Ada' } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ name: 'Ada' });
});

test.each([
  {
    label: 'malformed JSON',
    headers: { 'content-type': 'application/json' },
    payload: '{"name": ',
    status: 400,
    text: 'Bad Request',
  },
  {
    label: 'an unsupported media type',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'name=Ada',
    status: 415,
    text: 'Unsupported Media Type',
  },
])('$label is a client error with the standard status text', async ({ headers, payload, status, text }) => {
  const { app, logs } = await withRoutes();
  const response = await app.inject({ method: 'POST', url: '/echo', headers, payload });
  expect(response.statusCode).toBe(status);
  expect(errorResponseSchema.parse(response.json()).error.message).toBe(text);
  expect(logs.text()).not.toContain('name=Ada');
});

test('a body above the limit is refused as too large', async () => {
  const { app } = await withRoutes();
  const response = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }),
  });
  expect(response.statusCode).toBe(413);
  expect(errorResponseSchema.parse(response.json()).error.message).toBe(STATUS_CODES[413]);
});

test('an unknown route is a 404 with the request id', async () => {
  const { app } = await withRoutes();
  const response = await app.inject('/nope');
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error).toEqual({
    code: 'not_found',
    message: 'Not Found',
    requestId: response.headers['x-request-id'],
  });
});
