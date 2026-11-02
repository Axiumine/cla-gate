// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sessionResponseSchema } from './auth.ts';

const BODY = {
  user: { githubId: 1001, login: 'alice', name: 'Alice', avatarUrl: null },
  expiresAt: '2026-11-02T18:00:00.000Z',
  csrfToken: 'A'.repeat(43),
};

test('a session response carries the user, the end of the session and the CSRF token', () => {
  expect(sessionResponseSchema.parse(BODY)).toEqual(BODY);
});

test.each([
  ['missing', undefined],
  ['empty', ''],
  ['42 characters', 'A'.repeat(42)],
  ['44 characters', 'A'.repeat(44)],
  ['outside base64url', `${'A'.repeat(42)}+`],
  ['a number', 7],
])('a CSRF token that is %s is rejected', (_label, csrfToken) => {
  expect(sessionResponseSchema.safeParse({ ...BODY, csrfToken }).success).toBe(false);
});
