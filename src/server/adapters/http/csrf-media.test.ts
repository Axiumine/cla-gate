// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { authWorld } from './auth-fixture/test-support.ts';

// State-changing routes read JSON and nothing else (E10-S03). A form or a multipart body is the shape a cross-site form
// post has, so those, plain text and a body with no declared type are refused with 415 before any route sees them.

test.each([
  ['a urlencoded form', 'application/x-www-form-urlencoded', 'a=1&b=2'],
  ['a urlencoded form with a charset', 'application/x-www-form-urlencoded; charset=UTF-8', 'a=1'],
  [
    'multipart form data',
    'multipart/form-data; boundary=xyz',
    '--xyz\r\ncontent-disposition: form-data; name="a"\r\n\r\n1\r\n--xyz--\r\n',
  ],
  ['plain text, whose parser is removed', 'text/plain', 'hello'],
  ['plain text with a charset', 'text/plain; charset=utf-8', 'hello'],
  ['a type nobody parses', 'application/octet-stream', 'bytes'],
  ['XML', 'application/xml', '<a/>'],
  ['a JSON look-alike', 'application/jsonp', '{"a":1}'],
])('%s gets 415 unsupported_media_type', async (_label, type, payload) => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...alice.headers, 'content-type': type },
    payload,
  });
  expect(response.statusCode).toBe(415);
  const { error } = errorResponseSchema.parse(response.json());
  expect(error).toMatchObject({ code: 'unsupported_media_type', message: 'Unsupported Media Type' });
  expect(response.body).not.toContain(payload.slice(0, 5));
});

test('a form post from another site is refused as a media type before anything is read of it', async () => {
  const { app } = await authWorld();
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'a=1',
  });
  expect(response.statusCode).toBe(415);
});

test('a body with no content type at all is 415', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({ method: 'POST', url: '/probe/mutate', headers: alice.headers, payload: 'raw' });
  expect(response.statusCode).toBe(415);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('unsupported_media_type');
});

test.each([
  ['application/json', 'application/json'],
  ['application/json with a charset', 'application/json; charset=utf-8'],
  ['application/JSON in capitals', 'APPLICATION/JSON'],
])('%s is read as JSON', async (_label, type) => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...alice.headers, 'content-type': type },
    payload: '{"a":1}',
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ method: 'POST', body: { a: 1 } });
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
  'a %s with no body and no content type needs no content type',
  async (method) => {
    const { app, login } = await authWorld();
    const alice = await login(1001);
    const response = await app.inject({ method, url: '/probe/mutate', headers: alice.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ method, body: null });
  },
);

test('malformed JSON is a 400 with the standard body, not a 415', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...alice.headers, 'content-type': 'application/json' },
    payload: '{"a":',
  });
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('bad_request');
});

test('a media type refused on a state-changing request is logged by its code and never by its body', async () => {
  const { app, logs, login } = await authWorld();
  const alice = await login(1001);
  await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...alice.headers, 'content-type': 'text/plain' },
    payload: 'secret-looking-body',
  });
  expect(logs.text()).not.toContain('secret-looking-body');
  expect(logs.lines().find((line) => line['msg'] === 'request rejected')).toMatchObject({
    statusCode: 415,
    code: 'unsupported_media_type',
  });
});

test('GET is not affected: no body is read and no content type is asked for', async () => {
  const { app } = await authWorld();
  expect((await app.inject({ url: '/probe/safe' })).statusCode).toBe(200);
});

test.each([
  ['a form body', 'application/x-www-form-urlencoded', 'a=1'],
  ['a body with no content type', undefined, 'raw'],
])('%s sent to a path no route answers is still the plain 404', async (_label, type, payload) => {
  const { app } = await authWorld();
  const headers = type === undefined ? {} : { 'content-type': type };
  const response = await app.inject({ method: 'POST', url: '/nowhere', headers, payload });
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
});
