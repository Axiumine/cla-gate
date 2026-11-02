// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { expect, test } from 'vitest';
import { testGitHubKey } from '../../config/test-support.ts';
import { GitHubAuthError } from '../../services/ports/github-errors.ts';
import { fetchApp } from './app-api.ts';
import { appFixture, jwtSignedBy, mockApp } from './test-support.ts';

// Key rotation at the HTTP boundary (E05-S02): MSW plays GitHub, which accepts the public halves of the keys registered
// on the App and answers 401 to a JWT signed by any other.

test('the current key is accepted: one request, signed by it, no fallback', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const route = mockApp([current.publicKey, previous.publicKey]);
  const { check, logs } = appFixture([current.key, previous.key]);
  await check.verify();
  expect(route.tokens.map((token) => jwtSignedBy(token, current.publicKey))).toEqual([true]);
  expect(logs.lines().filter((line) => line['msg'] === 'github.app_key_fallback')).toEqual([]);
});

test('the current key refused and the previous accepted: retried once, promoted, and the next call signs with it', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const route = mockApp([previous.publicKey]);
  const { auth, check, logs } = appFixture([current.key, previous.key]);
  await check.verify();
  expect(route.tokens.map((token) => jwtSignedBy(token, current.publicKey))).toEqual([true, false]);
  expect(route.tokens.map((token) => jwtSignedBy(token, previous.publicKey))).toEqual([false, true]);

  await auth.withJwt((jwt) => fetchApp(fetch, jwt, 5000));
  expect(route.tokens).toHaveLength(3);
  expect(jwtSignedBy(route.tokens[2] ?? '', previous.publicKey)).toBe(true);
  expect(logs.lines().filter((line) => line['msg'] === 'github.app_key_fallback')).toMatchObject([
    { level: 40, keyFingerprint: previous.key.fingerprint },
  ]);
});

test('both keys refused: GitHubAuthError after exactly two requests', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const route = mockApp([testGitHubKey().publicKey]);
  const { check, logs } = appFixture([current.key, previous.key]);
  const failure: unknown = await check.verify().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubAuthError);
  expect(route.tokens).toHaveLength(2);
  expect(check.current()).toBeUndefined();
  expect(logs.lines().map((line) => line['msg'])).toEqual(['github.app_keys_refused']);
});

/** Everything an operator or a caller could read about a rotation: logs, and the error in every way of printing it. */
function visibleAfter(failure: unknown, logText: string): string {
  const details = failure instanceof Error ? [failure.message, failure.stack ?? '', String(failure.cause)] : [];
  return [logText, ...details, String(failure), inspect(failure, { depth: 8 }), JSON.stringify(failure)].join('\n');
}

/** The strings that must never be visible: every JWT GitHub received (and its signature) and every PEM (and a line of it). */
function secretsOf(tokens: readonly string[], pems: readonly string[]): string[] {
  const signatures = tokens.map((token) => token.split('.')[2] ?? '');
  const lines = pems.map((pem) => pem.split('\n')[1] ?? '');
  return [...tokens, ...signatures, ...pems, ...lines, 'PRIVATE KEY'];
}

test('a failing rotation leaves no JWT and no PEM in any log line, error message or cause', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const route = mockApp([testGitHubKey().publicKey]);
  const { check, logs } = appFixture([current.key, previous.key]);
  const failure: unknown = await check.verify().catch((error: unknown) => error);
  const visible = visibleAfter(failure, logs.text());
  expect(route.tokens).toHaveLength(2);
  expect(logs.lines()).not.toHaveLength(0);
  for (const secret of secretsOf(route.tokens, [current.pem, previous.pem])) {
    expect(secret).not.toBe('');
    expect(visible).not.toContain(secret);
  }
  expect(visible).toContain(current.key.fingerprint);
  expect(failure).not.toHaveProperty('cause');
});

test('a rotation that works leaves no JWT and no PEM in the logs either; the fingerprint is there', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const route = mockApp([previous.publicKey]);
  const { check, logs } = appFixture([current.key, previous.key]);
  await check.verify();
  const visible = logs.text();
  expect(visible).toContain(previous.key.fingerprint);
  for (const secret of secretsOf(route.tokens, [current.pem, previous.pem])) {
    expect(visible).not.toContain(secret);
  }
});
