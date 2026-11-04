// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { setupConvertRoute, setupSessionRoute } from '../../shared/setup.ts';
import { ApiError } from '../api/index.ts';
import { answer, asApiError, envelope, json, rejection } from '../api/test-support.ts';
import { setupClient, withSetupCode } from './setup-api.ts';
import { SETUP_CSRF } from './test-support.ts';

// E19-S07: the client of the setup calls and the reading of a 401 on the setup routes.

const BODY = { code: 'a180b1a3d263c81bc6441d7b990bae27d4c10679', state: 's'.repeat(43) };

test('a 401 gets the code the caller says it means, and keeps the status, the request id and the retry delay', async () => {
  const unauthorized = new ApiError({ status: 401, code: 'unauthenticated', requestId: 'req-7', retryAfterSeconds: 9 });
  const failure = asApiError(await rejection(withSetupCode(Promise.reject(unauthorized), 'setup_locked')));
  expect(failure.status).toBe(401);
  expect(failure.code).toBe('setup_locked');
  expect(failure.requestId).toBe('req-7');
  expect(failure.retryAfterSeconds).toBe(9);
});

test('the same 401 is invalid_setup_token for the unlock', async () => {
  const unauthorized = new ApiError({ status: 401, code: 'unauthenticated' });
  expect(asApiError(await rejection(withSetupCode(Promise.reject(unauthorized), 'invalid_setup_token'))).code).toBe(
    'invalid_setup_token',
  );
});

test.each([400, 403, 409, 429, 500, 502])('a %i passes through as the very same error', async (status) => {
  const original = new ApiError({ status, code: 'whatever' });
  expect(await rejection(withSetupCode(Promise.reject(original), 'setup_locked'))).toBe(original);
});

test('an error that is not an ApiError passes through, and so does a value', async () => {
  const original = new TypeError('offline');
  expect(await rejection(withSetupCode(Promise.reject(original), 'setup_locked'))).toBe(original);
  await expect(withSetupCode(Promise.resolve('fine'), 'setup_locked')).resolves.toBe('fine');
});

test('the setup client sends the CSRF token it was given in x-csrf-token on a POST', async () => {
  const seen = answer(setupConvertRoute.path, json({}, 400));
  await rejection(setupClient(SETUP_CSRF).call(setupConvertRoute, { body: BODY }));
  expect(seen).toHaveLength(1);
  expect(seen[0]?.headers['x-csrf-token']).toBe(SETUP_CSRF);
  expect(JSON.parse(seen[0]?.text ?? '')).toEqual(BODY);
});

test('it sends no token on a GET, and a refused token is not renewed: the request is not repeated', async () => {
  const get = answer(setupSessionRoute.path, json({ csrfToken: SETUP_CSRF }));
  await setupClient(SETUP_CSRF).call(setupSessionRoute, {});
  expect(get[0]?.headers['x-csrf-token']).toBeUndefined();
  const post = answer(setupConvertRoute.path, envelope(403, 'csrf_invalid'));
  const failure = asApiError(await rejection(setupClient(SETUP_CSRF).call(setupConvertRoute, { body: BODY })));
  expect(failure.code).toBe('csrf_invalid');
  expect(post).toHaveLength(1);
});
