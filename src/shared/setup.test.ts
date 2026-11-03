// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  APP_NAME_PATTERN,
  convertRequestSchema,
  convertResponseSchema,
  GITHUB_LOGIN_PATTERN,
  manifestRequestSchema,
  manifestResponseSchema,
  SETUP_CODE_PATTERN,
  SETUP_ERROR_CODES,
  SETUP_STATE_PATTERN,
  setupConvertRoute,
  setupManifestRoute,
  setupSessionRoute,
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

test('the routes of the setup, by method and path', () => {
  expect([
    setupStatusRoute.name,
    setupUnlockRoute.name,
    setupManifestRoute.name,
    setupSessionRoute.name,
    setupConvertRoute.name,
  ]).toEqual([
    'GET /api/setup/status',
    'POST /api/setup/unlock',
    'POST /api/setup/manifest',
    'GET /api/setup/session',
    'POST /api/setup/convert',
  ]);
});

test('the error codes the setup adds are seven, each a snake_case word', () => {
  expect(SETUP_ERROR_CODES).toEqual({
    invalidToken: 'invalid_setup_token',
    locked: 'setup_locked',
    originMismatch: 'origin_mismatch',
    codeInvalid: 'setup_code_invalid',
    alreadyIssued: 'setup_already_issued',
    githubUnreachable: 'github_unreachable',
    githubUnexpected: 'github_unexpected_response',
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

test('the session endpoint answers with the CSRF token of the unlock answer and nothing else', () => {
  expect(setupSessionRoute.responses[200]).toBe(unlockResponseSchema);
  expect('body' in setupSessionRoute).toBe(false);
});

test.each(['a', 'A1', '0', 'a'.repeat(64), 'a180b1a3d263c81bc6441d7b990bae27d4c10679'])(
  '%s is a code GitHub may send',
  (code) => {
    expect(SETUP_CODE_PATTERN.test(code)).toBe(true);
  },
);

test.each(['', 'a'.repeat(65), 'a-b', 'a_b', 'a b', 'é', 'a\n', '\na', 'a/b', '../x', 'a?b', '<b>'])(
  '%j is not a code GitHub may send',
  (code) => {
    expect(SETUP_CODE_PATTERN.test(code)).toBe(false);
  },
);

test('the state the page reads back is the 43 base64url characters the manifest answer carried', () => {
  expect(SETUP_STATE_PATTERN.test(STATE)).toBe(true);
  expect(SETUP_STATE_PATTERN.test(`${STATE}A`)).toBe(false);
  expect(SETUP_STATE_PATTERN.test(`${'A+'.repeat(21)}A`)).toBe(false);
});

test('the conversion takes the code and the state and no other key', () => {
  expect(convertRequestSchema.safeParse({ code: 'abc123', state: STATE }).success).toBe(true);
  expect(convertRequestSchema.safeParse({ code: 'abc123', state: STATE, more: 1 }).success).toBe(false);
  expect(convertRequestSchema.safeParse({ code: 'ab/c', state: STATE }).success).toBe(false);
  expect(convertRequestSchema.safeParse({ code: 'abc123', state: 'short' }).success).toBe(false);
  expect(convertRequestSchema.safeParse({ code: '', state: STATE }).success).toBe(false);
  expect(setupConvertRoute.body).toBe(convertRequestSchema);
});

const CONVERTED = {
  appId: 42,
  slug: 'cla-gate',
  htmlUrl: 'https://github.com/apps/cla-gate',
  installUrl: 'https://github.com/apps/cla-gate/installations/new',
  clientId: 'Iv1.0123456789abcdef',
  clientSecret: 'client-secret-value',
  webhookSecret: 'webhook-secret-value',
  privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n',
};

test('the conversion answer holds the App id, its address and its five credentials, each present', () => {
  expect(convertResponseSchema.parse(CONVERTED)).toEqual(CONVERTED);
  for (const key of Object.keys(CONVERTED)) {
    expect(convertResponseSchema.safeParse({ ...CONVERTED, [key]: undefined }).success).toBe(false);
  }
  expect(convertResponseSchema.safeParse({ ...CONVERTED, appId: 0 }).success).toBe(false);
  expect(convertResponseSchema.safeParse({ ...CONVERTED, appId: 1.5 }).success).toBe(false);
  expect(convertResponseSchema.safeParse({ ...CONVERTED, clientSecret: '' }).success).toBe(false);
});
