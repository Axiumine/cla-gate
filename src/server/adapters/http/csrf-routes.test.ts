// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CSRF_EXEMPT, csrfProblem, SETUP_ROUTES, skipsCsrfCheck } from './csrf-routes.ts';

// The two closed lists of routes the CSRF and Origin check does not cover (E10-S03), and the rules around them.

test('the exempt set is exactly the webhook route, spelled out here on purpose', () => {
  expect(CSRF_EXEMPT).toEqual(['POST /webhooks/github']);
});

test('the setup routes are the status, the unlock and the manifest, spelled out here on purpose', () => {
  expect(SETUP_ROUTES).toEqual(['GET /api/setup/status', 'POST /api/setup/unlock', 'POST /api/setup/manifest']);
});

test.each(['POST /api/setup/unlock', 'POST /api/setup/manifest'])('%s is skipped by name, with no flag', (name) => {
  const [method = '', url = ''] = name.split(' ');
  expect(skipsCsrfCheck(method, url, undefined)).toBe(true);
});

test.each([
  ['another method of the unlock', 'PUT', '/api/setup/unlock'],
  ['a path below the unlock', 'POST', '/api/setup/unlock/x'],
  ['the conversion, which E19-S11 adds', 'POST', '/api/setup/convert'],
  ['the login logout', 'POST', '/api/auth/logout'],
])('%s is not skipped', (_label, method, url) => {
  expect(skipsCsrfCheck(method, url, undefined)).toBe(false);
});

test.each([
  ['the webhook route flagged exempt', 'POST', '/webhooks/github', { csrf: 'exempt' }],
  ['the webhook route in lower case', 'post', '/webhooks/github', { csrf: 'exempt' }],
  ['a route with no flag', 'POST', '/api/anything', {}],
  ['a route with no config at all', 'POST', '/api/anything', undefined],
  ['a route whose flag is undefined', 'POST', '/api/anything', { csrf: undefined }],
  ['a route that only declares an audit action', 'POST', '/api/anything', { audit: 'repository.enabled' }],
])('%s is accepted at registration', (_label, method, url, config) => {
  expect(csrfProblem(method, url, config)).toBeUndefined();
});

test.each([
  ['another POST route', 'POST', '/api/anything', "route POST /api/anything sets config.csrf = 'exempt'"],
  ['a GET route', 'GET', '/webhooks/github', "route GET /webhooks/github sets config.csrf = 'exempt'"],
  [
    'another method of the webhook path',
    'PUT',
    '/webhooks/github',
    "route PUT /webhooks/github sets config.csrf = 'exempt'",
  ],
  [
    'the webhook path with a trailing slash',
    'POST',
    '/webhooks/github/',
    'route POST /webhooks/github/ sets config.csrf',
  ],
  ['the webhook path in another case', 'POST', '/Webhooks/github', 'route POST /Webhooks/github sets config.csrf'],
  ['a login route', 'GET', '/api/auth/login', 'route GET /api/auth/login sets config.csrf'],
])('%s cannot set the flag', (_label, method, url, message) => {
  expect(csrfProblem(method, url, { csrf: 'exempt' })).toContain(message);
});

test('a route answering several methods is refused when any one of them is not on the list', () => {
  expect(csrfProblem(['POST'], '/webhooks/github', { csrf: 'exempt' })).toBeUndefined();
  expect(csrfProblem(['POST', 'PUT'], '/webhooks/github', { csrf: 'exempt' })).toContain('route PUT /webhooks/github');
});

test.each([
  ['a made-up value', { csrf: 'skip' }],
  ['true', { csrf: true }],
  ['an empty string', { csrf: '' }],
  ['null', { csrf: null }],
  ['upper case', { csrf: 'EXEMPT' }],
])('a flag that is %s is refused, whatever the route', (_label, config) => {
  expect(csrfProblem('POST', '/webhooks/github', config)).toContain("declares a config.csrf that is not 'exempt'");
});

test('another list is honoured: the rule is the list, not a constant', () => {
  const sets = { exempt: ['DELETE /thing'], setup: [] };
  expect(csrfProblem('DELETE', '/thing', { csrf: 'exempt' }, sets)).toBeUndefined();
  expect(csrfProblem('POST', '/webhooks/github', { csrf: 'exempt' }, sets)).toContain('not in CSRF_EXEMPT');
});

test('the webhook route is skipped, and only when it is flagged', () => {
  expect(skipsCsrfCheck('POST', '/webhooks/github', { csrf: 'exempt' })).toBe(true);
  expect(skipsCsrfCheck('POST', '/webhooks/github', {})).toBe(false);
  expect(skipsCsrfCheck('POST', '/webhooks/github', undefined)).toBe(false);
});

test.each([
  ['another path', 'POST', '/api/anything'],
  ['another method', 'PUT', '/webhooks/github'],
  ['a trailing slash', 'POST', '/webhooks/github/'],
])('a flag on a route that is not on the list skips nothing (%s)', (_label, method, url) => {
  expect(skipsCsrfCheck(method, url, { csrf: 'exempt' })).toBe(false);
});

test('a setup route is skipped by name, with no flag, and only for its method', () => {
  const sets = { exempt: [], setup: ['POST /setup/start'] };
  expect(skipsCsrfCheck('POST', '/setup/start', undefined, sets)).toBe(true);
  expect(skipsCsrfCheck('PUT', '/setup/start', undefined, sets)).toBe(false);
  expect(skipsCsrfCheck('POST', '/setup/other', undefined, sets)).toBe(false);
});
