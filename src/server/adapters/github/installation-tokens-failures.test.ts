// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { delay, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import {
  GitHubAuthError,
  GitHubResponseError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationSuspendedError,
} from '../../services/ports/github-errors.ts';
import { FakeClock } from '../../services/test-support.ts';
import { hourlyTokens, jwtSignedBy, mockGitHub, START, tokensFixture, tokenWorld } from './test-support.ts';

const key = testGitHubKey();
const MINUTE = 60_000;
const id = parseGithubId;

/** A GitHub that issues tokens until a test sets `mode.failure`; the failure is then every answer. */
function switchable(waitMs = 0) {
  const mode: { failure: (() => Response) | undefined } = { failure: undefined };
  const world = tokenWorld(key, (clock) => {
    const issue = hourlyTokens(clock);
    return async (call) => {
      await delay(waitMs);
      return mode.failure?.() ?? issue(call);
    };
  });
  return { ...world, mode };
}

const failures = [
  [
    '404 (InstallationGoneError)',
    () => HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
    InstallationGoneError,
  ],
  [
    '403 saying suspended (InstallationSuspendedError)',
    () => HttpResponse.json({ message: 'This installation has been suspended' }, { status: 403 }),
    InstallationSuspendedError,
  ],
  ['503 (GitHubUnavailableError)', () => new HttpResponse(null, { status: 503 }), GitHubUnavailableError],
  [
    '500 with a body (GitHubUnavailableError)',
    () => HttpResponse.json({ message: 'boom' }, { status: 500 }),
    GitHubUnavailableError,
  ],
  ['network failure (GitHubUnavailableError)', () => HttpResponse.error(), GitHubUnavailableError],
  [
    'answer that is not a token (GitHubResponseError)',
    () => HttpResponse.json({ token: '' }, { status: 201 }),
    GitHubResponseError,
  ],
] as const;

test.each(failures)('a %s is raised and not cached: the next call asks GitHub again', async (_name, failure, error) => {
  const { tokens, mints, mode } = switchable();
  mode.failure = failure;
  await expect(tokens.get(id(7))).rejects.toBeInstanceOf(error);
  expect(tokens.size).toBe(0);
  await expect(tokens.get(id(7))).rejects.toBeInstanceOf(error);
  expect(mints).toHaveLength(2);
  mode.failure = undefined;
  expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-1');
  expect(mints).toHaveLength(3);
});

test.each(failures)(
  'a %s while a token is being refreshed drops the entry that was held',
  async (_name, failure, error) => {
    const { tokens, mints, mode, clock } = switchable();
    await tokens.get(id(7));
    await tokens.get(id(8));
    clock.advance(56 * MINUTE);
    mode.failure = failure;
    await expect(tokens.get(id(7))).rejects.toBeInstanceOf(error);
    expect(tokens.size).toBe(1);
    mode.failure = undefined;
    expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-3');
    expect(mints).toHaveLength(4);
  },
);

test('a 5xx is not retried by the provider: one POST per call', async () => {
  const { tokens, mints, mode } = switchable();
  mode.failure = () => new HttpResponse(null, { status: 502 });
  await expect(tokens.get(id(7))).rejects.toBeInstanceOf(GitHubUnavailableError);
  expect(mints).toHaveLength(1);
});

test('an answer that never comes ends at the timeout, as an outage, and nothing is cached', async () => {
  const clock = new FakeClock(START);
  mockGitHub([key.publicKey], {
    mint: async () => {
      await delay('infinite');
      return HttpResponse.json({});
    },
  });
  // The timeout is long enough for the connection to be made: one that fires in the middle of the TLS handshake leaves a
  // handshake that ends after the test, and the runner reports its error against whichever test runs next.
  const { tokens } = tokensFixture([key.key], { clock, timeoutMs: 1000 });
  await expect(tokens.get(id(7))).rejects.toThrow('GitHub could not be reached (TimeoutError)');
  expect(tokens.size).toBe(0);
});

test('50 concurrent calls that meet one failure make one POST and all get that failure; the next call tries again', async () => {
  const { tokens, mints, mode } = switchable(30);
  mode.failure = () => new HttpResponse(null, { status: 503 });
  const outcomes = await Promise.allSettled(Array.from({ length: 50 }, () => tokens.get(id(7))));
  expect(mints).toHaveLength(1);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(Array.from({ length: 50 }, () => 'rejected'));
  mode.failure = undefined;
  await tokens.get(id(7));
  expect(mints).toHaveLength(2);
});

test('a failure for one installation does not fail another', async () => {
  const { tokens, mode } = switchable();
  mode.failure = () => HttpResponse.json({ message: 'Not Found' }, { status: 404 });
  const gone = tokens.get(id(7));
  await expect(gone).rejects.toBeInstanceOf(InstallationGoneError);
  mode.failure = undefined;
  expect((await tokens.get(id(8))).token.reveal()).toBe('ghs_made-up-8-1');
});

test('a 401 retries once with the previous key, which is promoted for the next installation; one WARN names its fingerprint', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const clock = new FakeClock(START);
  const { mints } = mockGitHub([previous.publicKey], { mint: hourlyTokens(clock) });
  const { tokens, logs } = tokensFixture([current.key, previous.key], { clock });
  expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-1');
  expect(mints.map((call) => jwtSignedBy(call.jwt, previous.publicKey))).toEqual([false, true]);
  await tokens.get(id(8));
  expect(mints).toHaveLength(3);
  expect(jwtSignedBy(mints[2]?.jwt ?? '', previous.publicKey)).toBe(true);
  expect(logs.lines().filter((line) => line['msg'] === 'github.app_key_fallback')).toMatchObject([
    { keyFingerprint: previous.key.fingerprint },
  ]);
});

test('a 401 for every key is a GitHubAuthError of fixed text, with one POST per key, and nothing is cached', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const clock = new FakeClock(START);
  const { mints } = mockGitHub([testGitHubKey().publicKey], { mint: hourlyTokens(clock) });
  const { tokens } = tokensFixture([current.key, previous.key], { clock });
  const failure: unknown = await tokens.get(id(7)).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubAuthError);
  expect(failure).toHaveProperty('message', 'GitHub refused every App signing key');
  expect(mints).toHaveLength(2);
  expect(tokens.size).toBe(0);
});

test('a refused key is not an installation verdict: a 404 after the fallback is still InstallationGoneError', async () => {
  const [current, previous] = [testGitHubKey(), testGitHubKey()];
  const clock = new FakeClock(START);
  mockGitHub([previous.publicKey], { mint: () => new HttpResponse(null, { status: 404 }) });
  const { tokens } = tokensFixture([current.key, previous.key], { clock });
  await expect(tokens.get(id(7))).rejects.toBeInstanceOf(InstallationGoneError);
});
