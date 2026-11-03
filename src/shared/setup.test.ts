// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  APP_NAME_PATTERN,
  GITHUB_LOGIN_PATTERN,
  manifestRequestSchema,
  manifestResponseSchema,
  SETUP_ERROR_CODES,
  setupManifestRoute,
  setupStatusRoute,
  setupStatusSchema,
  setupUnlockRoute,
  unlockRequestSchema,
  unlockResponseSchema,
} from './setup.ts';

// E19-S06: the contract of the setup API, shared by the server and the setup page.

const STATE = 'A'.repeat(43);
const MANIFEST = {
  name: 'CLA Gate',
  url: 'https://cla.example.org',
  hook_attributes: { url: 'https://cla.example.org/webhooks/github', active: true },
  redirect_url: 'https://cla.example.org/setup/callback',
  callback_urls: ['https://cla.example.org/api/auth/callback'],
  setup_url: 'https://cla.example.org/',
  setup_on_update: false,
  public: false,
  request_oauth_on_install: false,
  default_permissions: { metadata: 'read' },
  default_events: ['pull_request'],
};

test('the routes are the three of the story, by method and path', () => {
  expect([setupStatusRoute.name, setupUnlockRoute.name, setupManifestRoute.name]).toEqual([
    'GET /api/setup/status',
    'POST /api/setup/unlock',
    'POST /api/setup/manifest',
  ]);
});

test('the error codes the setup adds are three, each a snake_case word', () => {
  expect(SETUP_ERROR_CODES).toEqual({
    invalidToken: 'invalid_setup_token',
    locked: 'setup_locked',
    originMismatch: 'origin_mismatch',
  });
});

test.each(['a', 'A', '0', 'octo-cat', 'a-b-c', 'a'.repeat(39), `a${'-'.repeat(37)}b`])(
  '%s is a GitHub login',
  (login) => {
    expect(GITHUB_LOGIN_PATTERN.test(login)).toBe(true);
  },
);

test.each(['', '-a', 'a-', 'a'.repeat(40), 'a b', 'a_b', 'a.b', 'é', 'a\n', '\na', 'a/b', '..', 'a?b', 'a#b'])(
  '%j is not a GitHub login',
  (login) => {
    expect(GITHUB_LOGIN_PATTERN.test(login)).toBe(false);
  },
);

test.each(['a', 'CLA Gate', 'cla-gate 2', 'a'.repeat(34), ' ', '-'])('%j is an App name', (name) => {
  expect(APP_NAME_PATTERN.test(name)).toBe(true);
});

test.each(['', 'a'.repeat(35), 'a.b', 'a_b', 'é', 'a/b', '<b>', 'a\n', "a'b"])('%j is not an App name', (name) => {
  expect(APP_NAME_PATTERN.test(name)).toBe(false);
});

test('the status is setup or configured and nothing else', () => {
  expect(setupStatusSchema.parse({ mode: 'setup' })).toEqual({ mode: 'setup' });
  expect(setupStatusSchema.parse({ mode: 'configured' })).toEqual({ mode: 'configured' });
  expect(setupStatusSchema.safeParse({ mode: 'normal' }).success).toBe(false);
});

test('the unlock takes a token of 1 to 512 characters and no other key', () => {
  expect(unlockRequestSchema.safeParse({ token: 'a' }).success).toBe(true);
  expect(unlockRequestSchema.safeParse({ token: 'a'.repeat(512) }).success).toBe(true);
  expect(unlockRequestSchema.safeParse({ token: '' }).success).toBe(false);
  expect(unlockRequestSchema.safeParse({ token: 'a'.repeat(513) }).success).toBe(false);
  expect(unlockRequestSchema.safeParse({ token: 'a', more: 1 }).success).toBe(false);
});

test('the CSRF token of the unlock answer is 43 base64url characters', () => {
  expect(unlockResponseSchema.safeParse({ csrfToken: STATE }).success).toBe(true);
  expect(unlockResponseSchema.safeParse({ csrfToken: `${STATE}=` }).success).toBe(false);
  expect(unlockResponseSchema.safeParse({ csrfToken: 'short' }).success).toBe(false);
});

test('a personal App names no organisation and an organisation App must name one', () => {
  const user = { ownerType: 'user', appName: 'CLA Gate', allowOtherAccounts: false };
  expect(manifestRequestSchema.safeParse(user).success).toBe(true);
  expect(manifestRequestSchema.safeParse({ ...user, organisation: 'acme' }).success).toBe(false);
  const organisation = { ...user, ownerType: 'organisation', organisation: 'acme' };
  expect(manifestRequestSchema.safeParse(organisation).success).toBe(true);
  expect(manifestRequestSchema.safeParse({ ...organisation, organisation: undefined }).success).toBe(false);
  expect(manifestRequestSchema.safeParse({ ...organisation, organisation: 'a/b' }).success).toBe(false);
});

test('the answer holds the address on GitHub only, for a user or an organisation, with the state in the query', () => {
  const answer = (actionUrl: string) => ({ actionUrl, manifest: MANIFEST, state: STATE });
  const good = [
    `https://github.com/settings/apps/new?state=${STATE}`,
    `https://github.com/organizations/acme-inc/settings/apps/new?state=${STATE}`,
  ];
  const bad = [
    `http://github.com/settings/apps/new?state=${STATE}`,
    `https://github.com.evil.example/settings/apps/new?state=${STATE}`,
    `https://evil.example/https://github.com/settings/apps/new?state=${STATE}`,
    `https://github.com/settings/apps/new?state=${STATE}&x=1`,
    `https://github.com/organizations/a/b/settings/apps/new?state=${STATE}`,
    'https://github.com/settings/apps/new?state=short',
  ];
  expect(good.map((url) => manifestResponseSchema.safeParse(answer(url)).success)).toEqual([true, true]);
  expect(bad.map((url) => manifestResponseSchema.safeParse(answer(url)).success)).toEqual(bad.map(() => false));
});
