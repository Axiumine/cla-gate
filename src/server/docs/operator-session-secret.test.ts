// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../shared/errors.ts';
import { authWorld } from '../adapters/http/auth-fixture/test-support.ts';
import { AUTH_ENV } from '../config/auth-fixture/test-support.ts';

// What docs/operations/key-rotation.md says happens when SESSION_SECRET is rotated (E19-S09): nobody is signed out, every
// CSRF token issued before the restart is refused with the error the page quotes, and a reload brings a token that works.

const ORIGIN = 'https://app.example.com';
const ROTATED = 'rotated-session-secret-0123456789a';

test('after the rotation a session made before it still works, its old token is refused, and the token of a reload is accepted', async () => {
  expect(ROTATED).not.toBe(AUTH_ENV['SESSION_SECRET']);
  const { app, login } = await authWorld({ PUBLIC_BASE_URL: ORIGIN, SESSION_SECRET: ROTATED });
  const alice = await login(1001);

  const signedIn = await app.inject({ url: '/probe/protected', headers: { cookie: alice.cookie } });
  expect(signedIn.statusCode).toBe(200);
  expect(signedIn.json()).toEqual({ githubId: 1001 });

  const refused = await app.inject({ method: 'POST', url: '/probe/mutate', headers: alice.headers });
  expect(refused.statusCode).toBe(403);
  expect(errorResponseSchema.parse(refused.json()).error.code).toBe('csrf_invalid');

  const reload = await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  const { csrfToken } = reload.json<{ csrfToken: string }>();
  const accepted = await app.inject({
    method: 'POST',
    url: '/probe/mutate',
    headers: { ...alice.headers, 'x-csrf-token': csrfToken },
  });
  expect(accepted.statusCode).toBe(200);
});
