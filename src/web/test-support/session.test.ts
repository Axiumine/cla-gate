// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sessionResponseSchema } from '../../shared/auth.ts';
import { ALICE, CSRF_TOKEN } from './session.ts';

test('the made-up session is one the shared contract accepts, and its token looks like the server mints them', () => {
  expect(sessionResponseSchema.parse(ALICE).csrfToken).toBe(CSRF_TOKEN);
  expect(CSRF_TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
});
