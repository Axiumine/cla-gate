// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { delay, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { ConfigError } from '../../config/env.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { GitHubResponseError } from '../../services/ports/github-errors.ts';
import { appBody, appFixture, decodeJwt, jwtSignedBy, mockApp } from './test-support.ts';

test('the identity of the App is verified and kept: owner id and type, slug and permissions', async () => {
  const key = testGitHubKey();
  mockApp([key.publicKey]);
  const { check, logs } = appFixture([key.key]);
  expect(check.current()).toBeUndefined();
  const identity = await check.verify();
  expect(identity).toEqual({
    appId: 4242,
    slug: 'cla-gate-test',
    ownerId: 9001,
    ownerType: 'Organization',
    permissions: { checks: 'write', metadata: 'read', pull_requests: 'read' },
  });
  expect(check.current()).toBe(identity);
  expect(logs.lines()).toMatchObject([
    { level: 30, msg: 'github.app_verified', appId: 4242, slug: 'cla-gate-test', ownerId: 9001 },
  ]);
});

test('a user-owned App is accepted too, and fields the platform does not use are dropped', async () => {
  const key = testGitHubKey();
  const owner = { login: 'jane', id: 12, type: 'User', email: 'jane@example.com' };
  mockApp([key.publicKey], () => HttpResponse.json(appBody({ owner })));
  const identity = await appFixture([key.key]).check.verify();
  expect(identity).toMatchObject({ ownerId: 12, ownerType: 'User' });
  expect(Object.keys(identity).sort((a, b) => a.localeCompare(b))).toEqual([
    'appId',
    'ownerId',
    'ownerType',
    'permissions',
    'slug',
  ]);
  expect(JSON.stringify(identity)).not.toContain('jane');
});

test('the request is GET /app with a Bearer JWT, signed by the key, with the version and user-agent headers', async () => {
  const key = testGitHubKey();
  const route = mockApp([key.publicKey]);
  const { check, auth } = appFixture([key.key]);
  await check.verify();
  expect(route.tokens).toEqual([auth.createJwt()]);
  expect(decodeJwt(route.tokens[0] ?? '').claims).toMatchObject({ iss: '4242' });
  const headers = route.headers[0];
  expect([headers?.get('accept'), headers?.get('x-github-api-version'), headers?.get('user-agent')]).toEqual([
    'application/vnd.github+json',
    '2022-11-28',
    'cla-gate',
  ]);
});

test('an App id that differs from GITHUB_APP_ID is a ConfigError naming only the variable, and nothing is kept', async () => {
  const key = testGitHubKey();
  mockApp([key.publicKey], () => HttpResponse.json(appBody({ id: 999 })));
  const { check, logs } = appFixture([key.key]);
  const failure: unknown = await check.verify().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ConfigError);
  expect(failure).toHaveProperty('variables', ['GITHUB_APP_ID']);
  expect(failure).toHaveProperty('message', 'Invalid environment configuration: GITHUB_APP_ID');
  expect(check.current()).toBeUndefined();
  expect(logs.lines()).toMatchObject([
    { level: 50, msg: 'github.app_id_mismatch', configuredAppId: '4242', githubAppId: 999 },
  ]);
});

test.each([
  ['missing', undefined, ['owner']],
  ['null, as GitHub sends for an App owned by an enterprise', null, ['owner']],
  ['of an account type the platform does not serve', { id: 5, type: 'Enterprise' }, ['owner.type']],
  ['without an id', { type: 'User' }, ['owner.id']],
])('an owner %s fails with a GitHubResponseError that names the route and the path', async (_name, owner, paths) => {
  const key = testGitHubKey();
  mockApp([key.publicKey], () => HttpResponse.json(appBody({ owner })));
  const { check } = appFixture([key.key]);
  const failure: unknown = await check.verify().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: 'GET /app', paths });
  expect(check.current()).toBeUndefined();
});

test.each([
  ['no slug', { slug: '' }, ['slug']],
  ['a negative id', { id: -1 }, ['id']],
  ['permissions that are not a map', { permissions: ['checks'] }, ['permissions']],
])('an answer with %s fails the schema at that path', async (_name, override, paths) => {
  const key = testGitHubKey();
  mockApp([key.publicKey], () => HttpResponse.json(appBody(override)));
  const failure: unknown = await appFixture([key.key])
    .check.verify()
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({ route: 'GET /app', paths });
});

test('the check is repeated until it has succeeded once: a failure is not kept, a success is', async () => {
  const key = testGitHubKey();
  let calls = 0;
  const route = mockApp([key.publicKey], () => {
    calls += 1;
    return calls === 1 ? HttpResponse.json({ message: 'down' }, { status: 503 }) : HttpResponse.json(appBody());
  });
  const { check } = appFixture([key.key]);
  await expect(check.verify()).rejects.toThrow('GitHub answered 503 to GET /app');
  expect(check.current()).toBeUndefined();
  const identity = await check.verify();
  expect(await check.verify()).toBe(identity);
  expect(route.tokens).toHaveLength(2);
});

test('callers that ask at the same time share one request', async () => {
  const key = testGitHubKey();
  const route = mockApp([key.publicKey], async () => {
    await delay(30);
    return HttpResponse.json(appBody());
  });
  const { check } = appFixture([key.key]);
  const identities = await Promise.all(Array.from({ length: 5 }, () => check.verify()));
  expect(route.tokens).toHaveLength(1);
  expect(new Set(identities).size).toBe(1);
});

test('the token that reaches GitHub is signed by the key, not by any other', async () => {
  const [key, other] = [testGitHubKey(), testGitHubKey()];
  const route = mockApp([key.publicKey]);
  await appFixture([key.key]).check.verify();
  expect(route.tokens.map((token) => jwtSignedBy(token, key.publicKey))).toEqual([true]);
  expect(route.tokens.map((token) => jwtSignedBy(token, other.publicKey))).toEqual([false]);
});
