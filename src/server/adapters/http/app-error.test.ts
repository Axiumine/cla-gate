// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { testApp } from '../../test-support.ts';
import { AppError, errorBody } from './errors.ts';

const DETAILS = { limit: 5, fields: ['name', 'email'], nested: { ok: false, none: null } };

async function withRoutes() {
  const test_ = await testApp();
  const { app } = test_;
  app.get('/plain', () => {
    throw new AppError(409, 'thing_exists');
  });
  app.get('/with-details', () => {
    throw new AppError(422, 'thing_invalid', DETAILS);
  });
  app.get('/empty-details', () => {
    throw new AppError(400, 'thing_empty', {});
  });
  app.get('/unavailable', () => {
    throw new AppError(503, 'thing_unavailable', { retryAfterSeconds: 30 });
  });
  app.get('/unknown-code-text', () => {
    throw new AppError(499, 'client_gone');
  });
  return test_;
}

test('an AppError carries its status, code and details, and its message is the code', () => {
  const error = new AppError(409, 'thing_exists', { id: 3 });
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ name: 'AppError', status: 409, code: 'thing_exists', message: 'thing_exists' });
  expect(error.details).toEqual({ id: 3 });
  expect(new AppError(500, 'broken').details).toBeUndefined();
});

test.each([
  ['a success status', 200, 'fine'],
  ['a redirect status', 302, 'moved'],
  ['status 399', 399, 'almost'],
  ['status 600', 600, 'beyond'],
  ['a fractional status', 404.5, 'half'],
  ['NaN', Number.NaN, 'nothing'],
  ['an empty code', 400, ''],
  ['a code with capitals', 400, 'Bad_Thing'],
  ['a code with a dash', 400, 'bad-thing'],
  ['a code with a space', 400, 'bad thing'],
  ['a code that starts with a digit', 400, '1bad'],
  ['a code that starts with an underscore', 400, '_bad'],
  ['a code with a trailing newline', 400, 'bad\n'],
])('%s is refused when the error is built', (_label, status, code) => {
  expect(() => new AppError(status, code)).toThrow(RangeError);
});

test.each([
  ['the lowest client status', 400],
  ['the highest status', 599],
])('%s is accepted', (_label, status) => {
  expect(new AppError(status, 'fine_code').status).toBe(status);
});

test('the handler sends the code of an AppError and the standard status text as the message', async () => {
  const { app } = await withRoutes();
  const response = await app.inject('/plain');
  expect(response.statusCode).toBe(409);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: { code: 'thing_exists', message: 'Conflict', requestId: response.headers['x-request-id'] },
  });
});

test('details are sent as a plain JSON object, and only when given', async () => {
  const { app } = await withRoutes();
  const given = await app.inject('/with-details');
  expect(given.statusCode).toBe(422);
  expect(errorResponseSchema.parse(given.json()).error).toEqual({
    code: 'thing_invalid',
    message: 'Unprocessable Entity',
    requestId: given.headers['x-request-id'],
    details: DETAILS,
  });
  const none = await app.inject('/plain');
  expect(Object.keys(none.json<{ error: object }>().error)).toEqual(['code', 'message', 'requestId']);
});

test('empty details are details: the key is sent with an empty object', async () => {
  const { app } = await withRoutes();
  const response = await app.inject('/empty-details');
  expect(response.json<{ error: { details: object } }>().error.details).toEqual({});
});

test('a client status without a standard text keeps the code and falls back to the plain message', async () => {
  const { app } = await withRoutes();
  const response = await app.inject('/unknown-code-text');
  expect(response.statusCode).toBe(499);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({ code: 'client_gone', message: 'Error' });
});

test('a rejected request logs the code of an AppError and nothing of its details', async () => {
  const { app, logs } = await withRoutes();
  await app.inject('/with-details');
  const logged = logs.lines().find((line) => line['msg'] === 'request rejected');
  expect(logged).toMatchObject({ level: 30, statusCode: 422, code: 'thing_invalid' });
  expect(logs.text()).not.toContain('"email"');
});

test('a server AppError keeps its status, is logged as an error, and sends its code and details', async () => {
  const { app, logs } = await withRoutes();
  const response = await app.inject('/unavailable');
  expect(response.statusCode).toBe(503);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({
    code: 'thing_unavailable',
    message: 'Service Unavailable',
    details: { retryAfterSeconds: 30 },
  });
  const logged = logs.lines().find((line) => line['msg'] === 'unhandled error');
  expect(logged).toMatchObject({ level: 50, err: { type: 'AppError', code: 'thing_unavailable' } });
});

test('an error that is not an AppError behaves as before: no code of ours, no details', async () => {
  const { app } = await testApp();
  app.get('/boom', () => {
    throw Object.assign(new Error('internal'), { statusCode: 409, code: 'not_for_clients', details: { a: 1 } });
  });
  const response = await app.inject('/boom');
  expect(response.statusCode).toBe(409);
  expect(errorResponseSchema.parse(response.json()).error).toEqual({
    code: 'conflict',
    message: 'Conflict',
    requestId: response.headers['x-request-id'],
  });
});

test('an AppError thrown while a request is being read still gets its own body', async () => {
  const { app } = await testApp();
  app.addHook('onRequest', () => {
    throw new AppError(429, 'slow_down', { retryAfterSeconds: 1 });
  });
  app.get('/never', () => 'unreachable');
  const response = await app.inject('/never');
  expect(response.statusCode).toBe(429);
  expect(response.json<{ error: { code: string } }>().error.code).toBe('slow_down');
});

test('errorBody builds the standard body, and an AppError brings its code and details', () => {
  expect(errorBody(404, 'req-1')).toEqual({ error: { code: 'not_found', message: 'Not Found', requestId: 'req-1' } });
  expect(errorBody(409, 'req-2', new AppError(409, 'thing_exists'))).toEqual({
    error: { code: 'thing_exists', message: 'Conflict', requestId: 'req-2' },
  });
  expect(errorBody(409, 'req-3', new AppError(409, 'thing_exists', { id: 1 }))).toEqual({
    error: { code: 'thing_exists', message: 'Conflict', requestId: 'req-3', details: { id: 1 } },
  });
});
