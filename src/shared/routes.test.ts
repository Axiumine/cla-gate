// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { WEBHOOK_PATH } from './routes.ts';

test('the webhook path is the one GitHub is told to post to', () => {
  expect(WEBHOOK_PATH).toBe('/webhooks/github');
});

test('the webhook path is absolute, outside /api, and has no query or trailing slash', () => {
  expect(WEBHOOK_PATH).toMatch(/^\/[a-z]+\/[a-z]+$/);
  expect(WEBHOOK_PATH.startsWith('/api')).toBe(false);
});
