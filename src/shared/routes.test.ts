// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { LOGIN_CALLBACK_PATH, SETUP_CALLBACK_PATH, SETUP_PATH, WEBHOOK_PATH } from './routes.ts';

test('the webhook path is the one GitHub is told to post to', () => {
  expect(WEBHOOK_PATH).toBe('/webhooks/github');
});

test('the webhook path is absolute, outside /api, and has no query or trailing slash', () => {
  expect(WEBHOOK_PATH).toMatch(/^\/[a-z]+\/[a-z]+$/);
  expect(WEBHOOK_PATH.startsWith('/api')).toBe(false);
});

test('the login callback is below /api and the setup page and its callback are pages of the app, not API routes', () => {
  expect(LOGIN_CALLBACK_PATH).toBe('/api/auth/callback');
  expect(SETUP_PATH).toBe('/setup');
  expect(SETUP_CALLBACK_PATH).toBe('/setup/callback');
  expect(SETUP_CALLBACK_PATH.startsWith(`${SETUP_PATH}/`)).toBe(true);
  expect(SETUP_PATH.startsWith('/api')).toBe(false);
});
