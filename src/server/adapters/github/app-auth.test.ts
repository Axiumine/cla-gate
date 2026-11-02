// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { type TestGitHubKey, testGitHubKey } from '../../config/test-support.ts';
import { GitHubAuthError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { FakeClock } from '../../services/test-support.ts';
import { captureLogs } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { AppAuth, type KeyList } from './app-auth.ts';
import { decodeJwt, jwtSignedBy, START } from './test-support.ts';

const START_SECONDS = 1_793_613_600;

function setup(keys: KeyList) {
  const clock = new FakeClock(START);
  const logs = captureLogs();
  const auth = new AppAuth({
    appId: '4242',
    keys,
    clock,
    logger: createLogger({ logLevel: 'info' }, logs.destination),
  });
  return { auth, clock, logs };
}

const iatOf = (token: string): unknown => decodeJwt(token).claims['iat'];

test('createJwt signs with the current key, with the claims of the fixed clock', () => {
  const current = testGitHubKey();
  const { auth } = setup([current.key, testGitHubKey().key]);
  const token = auth.createJwt();
  expect(jwtSignedBy(token, current.publicKey)).toBe(true);
  expect(decodeJwt(token).claims).toEqual({ iat: START_SECONDS - 60, exp: START_SECONDS + 540, iss: '4242' });
});

test('the claims are whole seconds even when the clock is between two', () => {
  const { auth, clock } = setup([testGitHubKey().key]);
  clock.advance(999);
  expect(decodeJwt(auth.createJwt()).claims).toMatchObject({ iat: START_SECONDS - 60, exp: START_SECONDS + 540 });
});

test('a token is reused for less than five minutes', () => {
  const { auth, clock } = setup([testGitHubKey().key]);
  const first = auth.createJwt();
  clock.advance(5 * 60 * 1000 - 1);
  expect(auth.createJwt()).toBe(first);
  expect(iatOf(auth.createJwt())).toBe(START_SECONDS - 60);
});

test('at five minutes the token is minted again, with the claims of that moment', () => {
  const { auth, clock } = setup([testGitHubKey().key]);
  const first = auth.createJwt();
  clock.advance(5 * 60 * 1000);
  const second = auth.createJwt();
  expect(second).not.toBe(first);
  expect(decodeJwt(second).claims).toEqual({
    iat: START_SECONDS + 300 - 60,
    exp: START_SECONDS + 300 + 540,
    iss: '4242',
  });
});

test('a reused token still has at least four minutes to live', () => {
  const { auth, clock } = setup([testGitHubKey().key]);
  const token = auth.createJwt();
  clock.advance(5 * 60 * 1000 - 1);
  expect(Number(decodeJwt(token).claims['exp']) - (START_SECONDS + 299)).toBeGreaterThanOrEqual(4 * 60 - 1);
});

test('withJwt hands the token of the current key to the request and returns what it returns', async () => {
  const current = testGitHubKey();
  const { auth, logs } = setup([current.key, testGitHubKey().key]);
  const send = vi.fn((jwt: string) => Promise.resolve(jwtSignedBy(jwt, current.publicKey)));
  expect(await auth.withJwt(send)).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(logs.lines()).toEqual([]);
});

/** A request that GitHub answers 401 unless the token was signed by `accepted`. */
const acceptingOnly =
  (...accepted: TestGitHubKey[]) =>
  (jwt: string): Promise<string> =>
    accepted.some((key) => jwtSignedBy(jwt, key.publicKey))
      ? Promise.resolve('accepted')
      : Promise.reject(new GitHubAuthError());

test('a 401 retries once with the next key, promotes the key that worked and warns once with its fingerprint', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const { auth, logs } = setup([current.key, previous.key]);
  const send = vi.fn(acceptingOnly(previous));
  expect(await auth.withJwt(send)).toBe('accepted');
  expect(send).toHaveBeenCalledTimes(2);
  expect(logs.lines()).toMatchObject([
    { level: 40, msg: 'github.app_key_fallback', keyFingerprint: previous.key.fingerprint },
  ]);
});

test('the promoted key signs the calls that follow, and createJwt follows it', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const { auth, logs } = setup([current.key, previous.key]);
  await auth.withJwt(acceptingOnly(previous));
  const send = vi.fn(acceptingOnly(previous));
  await auth.withJwt(send);
  expect(send).toHaveBeenCalledOnce();
  expect(jwtSignedBy(auth.createJwt(), previous.publicKey)).toBe(true);
  expect(logs.lines()).toHaveLength(1);
});

test('when the promoted key is refused later the old one is tried and promoted back, with a new warning', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const { auth, logs } = setup([current.key, previous.key]);
  await auth.withJwt(acceptingOnly(previous));
  await auth.withJwt(acceptingOnly(current));
  expect(jwtSignedBy(auth.createJwt(), current.publicKey)).toBe(true);
  expect(logs.lines().map((line) => line['keyFingerprint'])).toEqual([
    previous.key.fingerprint,
    current.key.fingerprint,
  ]);
});

test('calls that fall back at the same time promote once and warn once', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const { auth, logs } = setup([current.key, previous.key]);
  const results = await Promise.all(Array.from({ length: 5 }, () => auth.withJwt(acceptingOnly(previous))));
  expect(results).toEqual(Array.from({ length: 5 }, () => 'accepted'));
  expect(logs.lines().filter((line) => line['msg'] === 'github.app_key_fallback')).toHaveLength(1);
});

test('every key refused fails with a GitHubAuthError of our own, and logs the fingerprints of the keys', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const { auth, logs } = setup([current.key, previous.key]);
  const send = vi.fn(acceptingOnly());
  const failure: unknown = await auth.withJwt(send).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubAuthError);
  expect(failure).toHaveProperty('message', 'GitHub refused every App signing key');
  expect(failure).not.toHaveProperty('cause');
  expect(send).toHaveBeenCalledTimes(2);
  expect(logs.lines()).toMatchObject([
    { level: 50, msg: 'github.app_keys_refused', keyFingerprints: [current.key.fingerprint, previous.key.fingerprint] },
  ]);
});

test('a single key that is refused fails after one attempt', async () => {
  const { auth } = setup([testGitHubKey().key]);
  const send = vi.fn(acceptingOnly());
  await expect(auth.withJwt(send)).rejects.toThrow(GitHubAuthError);
  expect(send).toHaveBeenCalledOnce();
});

test('an error that is not a 401 passes through untouched: no second key, no promotion, no log', async () => {
  const { auth, logs } = setup([testGitHubKey().key, testGitHubKey().key]);
  const outage = new GitHubUnavailableError('GitHub answered 503 to GET /app');
  const send = vi.fn(() => Promise.reject(outage));
  await expect(auth.withJwt(send)).rejects.toBe(outage);
  expect(send).toHaveBeenCalledOnce();
  expect(logs.lines()).toEqual([]);
});

test('a refusal that carries a token in its message is replaced, not passed on', async () => {
  const { auth } = setup([testGitHubKey().key]);
  const failure: unknown = await auth
    .withJwt((jwt) => Promise.reject(new GitHubAuthError(`refused ${jwt}`)))
    .catch((error: unknown) => error);
  expect(failure).toHaveProperty('message', 'GitHub refused every App signing key');
});
