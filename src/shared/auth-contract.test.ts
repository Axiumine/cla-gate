// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { logoutRequestSchema, sessionResponseSchema } from './auth.ts';
import { CSRF_HEADER, logoutRoute, sessionRoute } from './auth-contract.ts';
import { responseSchemaFor } from './contract.ts';

test('the session route is GET /api/auth/session and answers with the session schema', () => {
  expect(sessionRoute.name).toBe('GET /api/auth/session');
  expect(responseSchemaFor(sessionRoute, 200)).toBe(sessionResponseSchema);
});

test('the logout route is POST /api/auth/logout, takes the strict optional body and answers 204 with nothing', () => {
  expect(logoutRoute.name).toBe('POST /api/auth/logout');
  expect(logoutRoute.body).toBe(logoutRequestSchema);
  const empty = responseSchemaFor(logoutRoute, 204);
  expect(empty?.safeParse(undefined).success).toBe(true);
  expect(empty?.safeParse({}).success).toBe(false);
});

test('the CSRF token travels in the header E10 reads', () => {
  expect(CSRF_HEADER).toBe('x-csrf-token');
});
