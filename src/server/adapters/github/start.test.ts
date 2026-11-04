// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { KeyObject } from 'node:crypto';
import { delay, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { ConfigError } from '../../config/config-error.ts';
import { Secret } from '../../config/secret.ts';
import { TEST_WEBHOOK_SECRET, type TestGitHubKey, testGitHubKey } from '../../config/test-support.ts';
import { GitHubAuthError, GitHubResponseError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { FakeClock } from '../../services/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { startGitHubApp } from './start.ts';
import { APP_ID, appBody, jwtSignedBy, mockApp, START } from './test-support.ts';

const PRODUCTION = {
  ...AUTH_ENV,
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://cla.example.test',
  GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
};

function start(env: Record<string, string>, timeoutMs?: number) {
  const logs = captureLogs();
  const result = startGitHubApp({
    config: testConfig(env),
    logger: createLogger({ logLevel: 'info' }, logs.destination),
    clock: new FakeClock(START),
    fetch,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { result, logs };
}

const credentials = (key: TestGitHubKey, previous?: TestGitHubKey): Record<string, string> => ({
  GITHUB_APP_ID: APP_ID,
  GITHUB_APP_PRIVATE_KEY: key.pem,
  ...(previous === undefined ? {} : { GITHUB_APP_PRIVATE_KEY_PREVIOUS: previous.pem }),
});

test.each([
  ['neither the App id nor the key', {}],
  ['the App id without the key', { GITHUB_APP_ID: APP_ID }],
  ['the key without the App id', { GITHUB_APP_PRIVATE_KEY: testGitHubKey().pem }],
])('with %s there is no GitHub App and no request is made', async (_name, env) => {
  const route = mockApp([]);
  const { result, logs } = start(env);
  expect(await result).toBeUndefined();
  expect(route.tokens).toEqual([]);
  expect(logs.lines()).toEqual([]);
});

test('with the App id and a key it builds the signer, runs the self-check and keeps the identity', async () => {
  const key = testGitHubKey();
  const route = mockApp([key.publicKey]);
  const { result, logs } = start(credentials(key));
  const app = await result;
  expect(route.tokens).toHaveLength(1);
  expect(app?.identity.current()).toMatchObject({ appId: 4242, ownerId: 9001, ownerType: 'Organization' });
  expect(logs.lines().map((line) => line['msg'])).toEqual(['github.app_verified']);
});

test('during a rotation the previous key is in the list: a refused current key falls back at start-up', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  mockApp([previous.publicKey]);
  const { result, logs } = start(credentials(current, previous), 5000);
  expect((await result)?.identity.current()).toBeDefined();
  expect(logs.lines().map((line) => line['msg'])).toEqual(['github.app_key_fallback', 'github.app_verified']);
});

test('a 401 is fatal in production and names no key', async () => {
  const key = testGitHubKey();
  mockApp([testGitHubKey().publicKey]);
  const { result } = start({ ...PRODUCTION, ...credentials(key) });
  await expect(result).rejects.toThrow(GitHubAuthError);
  await expect(result).rejects.toThrow('GitHub refused every App signing key');
});

/** A GitHub whose accepted keys and health can change during the test: the outage is over when `state.up` is true. */
function flakyGitHub(failure: () => Response): { accepts: KeyObject[]; state: { up: boolean }; tokens: string[] } {
  const accepts: KeyObject[] = [];
  const state = { up: false };
  const route = mockApp(accepts, () => (state.up ? HttpResponse.json(appBody()) : failure()));
  return { accepts, state, tokens: route.tokens };
}

test('a 401 outside production is a warning: the instance starts and the check is repeated on first use', async () => {
  const key = testGitHubKey();
  const github = flakyGitHub(() => new HttpResponse(null, { status: 500 }));
  const { result, logs } = start(credentials(key));
  const app = await result;
  expect(app?.identity.current()).toBeUndefined();
  expect(logs.lines()).toMatchObject([
    { level: 50, msg: 'github.app_keys_refused' },
    { level: 40, msg: 'github.app_check_deferred', err: { type: 'GitHubAuthError' } },
  ]);
  github.accepts.push(key.publicKey);
  github.state.up = true;
  expect((await app?.identity.verify())?.slug).toBe('cla-gate-test');
});

test.each([
  ['a 503', () => new HttpResponse(null, { status: 503 }), 'GitHubUnavailableError'],
  ['a 500 with a body', () => HttpResponse.json({ message: 'boom' }, { status: 500 }), 'GitHubUnavailableError'],
])(
  '%s is a warning in production: the instance starts, and the first use repeats the check',
  async (_name, failure, type) => {
    const key = testGitHubKey();
    const github = flakyGitHub(failure);
    github.accepts.push(key.publicKey);
    const { result, logs } = start({ ...PRODUCTION, ...credentials(key) });
    const app = await result;
    expect(app?.identity.current()).toBeUndefined();
    expect(logs.lines()).toMatchObject([{ level: 40, msg: 'github.app_check_deferred', err: { type } }]);
    github.state.up = true;
    expect(await app?.identity.verify()).toMatchObject({ appId: 4242 });
    expect(github.tokens).toHaveLength(2);
  },
);

test('a rate limit too long to wait out is a warning in production too, and the first use is refused until it has run out', async () => {
  const key = testGitHubKey();
  const github = flakyGitHub(() =>
    HttpResponse.json({ message: 'slow down' }, { status: 429, headers: { 'retry-after': '120' } }),
  );
  github.accepts.push(key.publicKey);
  const { result, logs } = start({ ...PRODUCTION, ...credentials(key) });
  const app = await result;
  expect(app?.identity.current()).toBeUndefined();
  expect(logs.lines()).toMatchObject([
    { level: 40, msg: 'github.app_check_deferred', err: { type: 'GitHubRateLimitedError' } },
  ]);
  github.state.up = true;
  await expect(app?.identity.verify()).rejects.toMatchObject({
    name: 'GitHubRateLimitedError',
    retryAfterSeconds: 120,
  });
  expect(github.tokens).toHaveLength(1);
});

test.each([
  ['a network failure', () => HttpResponse.error()],
  [
    'a GitHub that never answers',
    async () => {
      await delay('infinite');
      return HttpResponse.json({});
    },
  ],
])('%s is a warning in production, and the check stays open', async (_name, answer) => {
  const key = testGitHubKey();
  mockApp([key.publicKey], answer);
  // The timeout is long enough for the connection to be made: one of 30 ms that fires in the middle of the TLS handshake
  // leaves a handshake that ends after the test, and the runner reports its error (an unhandled ERR_TLS_CERT_ALTNAME_INVALID)
  // against whichever test runs next.
  const { result, logs } = start({ ...PRODUCTION, ...credentials(key) }, 1000);
  const app = await result;
  expect(app?.identity.current()).toBeUndefined();
  expect(logs.lines()).toMatchObject([{ level: 40, msg: 'github.app_check_deferred' }]);
  await expect(app?.identity.verify()).rejects.toThrow(GitHubUnavailableError);
});

test.each([['development'], ['production']])(
  'an App id that is not the one in the configuration is fatal in %s',
  async (env) => {
    const key = testGitHubKey();
    mockApp([key.publicKey], () => HttpResponse.json(appBody({ id: 7 })));
    const { result } = start({ ...(env === 'production' ? PRODUCTION : {}), ...credentials(key) });
    const failure: unknown = await result.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConfigError);
    expect(failure).toHaveProperty('variables', ['GITHUB_APP_ID']);
  },
);

test.each([['development'], ['production']])('an answer without an owner is fatal in %s', async (env) => {
  const key = testGitHubKey();
  mockApp([key.publicKey], () => HttpResponse.json(appBody({ owner: undefined })));
  const { result } = start({ ...(env === 'production' ? PRODUCTION : {}), ...credentials(key) });
  const failure: unknown = await result.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ paths: ['owner'] });
});

test('anything unforeseen is fatal too, and the message does not quote the key', async () => {
  const route = mockApp([]);
  const garbage = new Secret('definitely-not-a-pem-key-text');
  const config = testConfig(credentials(testGitHubKey()));
  const broken = { ...config, github: { ...config.github, privateKey: { pem: garbage, fingerprint: 'SHA256:x' } } };
  const logs = captureLogs();
  const failure: unknown = await startGitHubApp({
    config: broken,
    logger: createLogger({ logLevel: 'info' }, logs.destination),
    clock: new FakeClock(START),
    fetch,
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(GitHubUnavailableError);
  expect(String(failure)).not.toContain('definitely-not-a-pem-key-text');
  expect(route.tokens).toEqual([]);
});

test('the first request made as the App repeats the check that an outage skipped, then sends; later requests do not', async () => {
  const key = testGitHubKey();
  const github = flakyGitHub(() => new HttpResponse(null, { status: 503 }));
  github.accepts.push(key.publicKey);
  const app = await start(credentials(key)).result;
  expect(github.tokens).toHaveLength(1);
  github.state.up = true;
  const sent: string[] = [];
  const send = (jwt: string): Promise<string> => {
    sent.push(`after ${github.tokens.length} checks`);
    return Promise.resolve(jwt);
  };
  const first = await app?.withJwt(send);
  expect(github.tokens).toHaveLength(2);
  expect(first).toBe(github.tokens[1]);
  await app?.withJwt(send);
  expect(github.tokens).toHaveLength(2);
  expect(sent).toEqual(['after 2 checks', 'after 2 checks']);
});

test('while the check still fails, a request made as the App is not sent', async () => {
  const key = testGitHubKey();
  const github = flakyGitHub(() => new HttpResponse(null, { status: 503 }));
  github.accepts.push(key.publicKey);
  const app = await start(credentials(key)).result;
  const send = vi.fn((jwt: string) => Promise.resolve(jwt));
  await expect(app?.withJwt(send)).rejects.toThrow(GitHubUnavailableError);
  expect(send).not.toHaveBeenCalled();
});

test('a request made as the App falls back to the previous key like any other, and the verified identity stays', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  mockApp([current.publicKey, previous.publicKey]);
  const app = await start(credentials(current, previous)).result;
  const refusingCurrent = (jwt: string): Promise<string> =>
    jwtSignedBy(jwt, previous.publicKey) ? Promise.resolve('sent') : Promise.reject(new GitHubAuthError());
  expect(await app?.withJwt(refusingCurrent)).toBe('sent');
  expect(app?.identity.current()?.appId).toBe(4242);
});
