// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sessionResponseSchema } from '../../../shared/auth.ts';
import {
  CSRF_HEADER,
  LOGIN_PATH,
  LOGIN_RETURN_TO_PARAM,
  logoutRoute,
  sessionRoute,
} from '../../../shared/auth-contract.ts';
import { responseSchemaFor } from '../../../shared/contract.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { authWorld } from './auth-fixture/test-support.ts';

// The session routes are registered from the descriptors that the web client calls them by (E17-S04): what a descriptor
// says is what the running server does.

test('the session route answers at its descriptor path with a body its descriptor schema accepts and the token of the session', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({
    method: sessionRoute.method,
    url: sessionRoute.path,
    headers: { cookie: alice.cookie },
  });
  expect(response.statusCode).toBe(200);
  const schema = responseSchemaFor(sessionRoute, 200);
  expect(schema?.parse(response.json())).toEqual(sessionResponseSchema.parse(response.json()));
  expect(sessionResponseSchema.parse(response.json()).csrfToken).toBe(alice.token);
});

test('without a session the route is a 401 whose own code is unauthorized, which the client reports as unauthenticated', async () => {
  const { app } = await authWorld();
  const response = await app.inject({ method: sessionRoute.method, url: sessionRoute.path });
  expect(response.statusCode).toBe(401);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('unauthorized');
});

test.each([
  ['no body at all', undefined],
  ['an empty object', {}],
  ['everywhere', { everywhere: true }],
])('logout answers 204 at its descriptor path to %s, with the token in the shared header name', async (_what, body) => {
  expect(logoutRoute.body.safeParse(body).success).toBe(true);
  const { app, login, origin } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({
    method: logoutRoute.method,
    url: logoutRoute.path,
    headers: {
      cookie: alice.cookie,
      origin,
      [CSRF_HEADER]: alice.token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  expect(response.statusCode).toBe(204);
  expect(response.body).toBe('');
  expect(logoutRoute.responses[204].safeParse(undefined).success).toBe(true);
});

test('logout without the token in that header is a 403 csrf_invalid, the answer the client reacts to', async () => {
  const { app, login, origin } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({
    method: logoutRoute.method,
    url: logoutRoute.path,
    headers: { cookie: alice.cookie, origin },
  });
  expect(response.statusCode).toBe(403);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('csrf_invalid');
});

test('the login start is registered at the shared path and reads the shared parameter: a logged-in caller goes straight to the checked path', async () => {
  const { app, login } = await authWorld();
  const alice = await login(1001);
  const response = await app.inject({
    url: `${LOGIN_PATH}?${LOGIN_RETURN_TO_PARAM}=${encodeURIComponent('/sign/42?pr=7')}`,
    headers: { cookie: alice.cookie },
  });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('/sign/42?pr=7');
  expect(response.headers['set-cookie']).toBeUndefined();
});
