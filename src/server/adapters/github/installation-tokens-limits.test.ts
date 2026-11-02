// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { GitHubRateLimitedError } from '../../services/ports/github-errors.ts';
import { hourlyTokens, type MintAnswer, START, tokenBody, tokenWorld } from './test-support.ts';

// The token mint runs through the rate limiter (E05-S05): a POST to the installation's lane, so GitHub's limits are
// waited out or handed to the job layer instead of being taken for an outage, and the mint is paced, counted and capped
// like every other request of the GitHub client.

const key = testGitHubKey();
const id = parseGithubId;
const ROUTE = 'POST /app/installations/{installation_id}/access_tokens';

const issued = () =>
  HttpResponse.json(tokenBody('ghs_made-up-token', new Date(Date.parse(START) + 3_600_000)), { status: 201 });

/** A token route that answers `answers` in turn and then issues tokens. */
function afterwards(...answers: (() => Response)[]): MintAnswer {
  const queue = [...answers];
  return () => (queue.shift() ?? issued)();
}

const limited =
  (status: number, headers: Record<string, string>, message = 'rate limited') =>
  () =>
    HttpResponse.json({ message }, { status, headers });

const warnings = (logs: { lines(): Record<string, unknown>[] }) =>
  logs.lines().filter((line) => line['msg'] === 'github.rate_limited');

test.each([
  ['a 429 with retry-after', limited(429, { 'retry-after': '2' }), 2000, 'secondary'],
  [
    'a 403 secondary limit with retry-after',
    limited(403, { 'retry-after': '30' }, 'You have exceeded a secondary rate limit'),
    30_000,
    'secondary',
  ],
  [
    'a 403 whose budget is used up, reset in 20 s',
    limited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.parse(START) / 1000 + 20) }),
    20_000,
    'primary',
  ],
  [
    'a 403 worded as a rate limit with no header: the minute GitHub advises',
    limited(403, {}, 'API rate limit exceeded'),
    60_000,
    'secondary',
  ],
] as const)(
  '%s on the mint is waited out and the mint repeated, with one WARN',
  async (_name, limit, waitMs, scope) => {
    const { tokens, mints, waits, logs } = tokenWorld(key, () => afterwards(limit));
    const token = await tokens.get(id(11));
    expect(token.token.reveal()).toBe('ghs_made-up-token');
    expect([mints.length, waits]).toEqual([2, [waitMs]]);
    expect(warnings(logs)).toMatchObject([
      { level: 40, scope, route: ROUTE, installationId: 11, waitSeconds: waitMs / 1000 },
    ]);
  },
);

test('a limit of more than a minute is raised as GitHubRateLimitedError, not taken for an outage, and is not repeated', async () => {
  const { tokens, mints, waits } = tokenWorld(key, () => afterwards(limited(429, { 'retry-after': '120' })));
  const failure = await tokens.get(id(11)).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: 120, scope: 'secondary' });
  expect([mints.length, waits]).toEqual([1, []]);
});

test('the installation lane stays shut for the length of the limit: no new mint is sent, and no other installation is held', async () => {
  const { tokens, mints, clock } = tokenWorld(key, () => afterwards(limited(429, { 'retry-after': '120' })));
  await tokens.get(id(11)).catch((error: unknown) => error);
  const again = await tokens.get(id(11)).catch((error: unknown) => error);
  expect(again).toMatchObject({ retryAfterSeconds: 120 });
  expect(mints).toHaveLength(1);
  expect((await tokens.get(id(12))).token.reveal()).toBe('ghs_made-up-token');
  expect(mints.map((call) => call.installationId)).toEqual(['11', '12']);
  clock.advance(120_000);
  expect((await tokens.get(id(11))).token.reveal()).toBe('ghs_made-up-token');
});

test('a third limit in a row is raised after two waits', async () => {
  const limit = limited(429, { 'retry-after': '5' });
  const { tokens, mints, waits } = tokenWorld(key, () => afterwards(limit, limit, limit));
  const failure = await tokens.get(id(11)).catch((error: unknown) => error);
  expect(failure).toMatchObject({ name: 'GitHubRateLimitedError', retryAfterSeconds: 5 });
  expect([mints.length, waits]).toEqual([3, [5000, 5000]]);
});

test('a mint is a write: a second mint for the installation starts a second after the first', async () => {
  const { tokens, mints, waits } = tokenWorld(key, hourlyTokens);
  await tokens.get(id(11));
  tokens.invalidate(id(11));
  await tokens.get(id(11));
  expect([mints.length, waits]).toEqual([2, [1000]]);
});

test('at most 50 mints are in flight at once over all installations', async () => {
  const release = Promise.withResolvers<undefined>();
  let going = 0;
  let peak = 0;
  const { tokens } = tokenWorld(key, (clock) => {
    const issue = hourlyTokens(clock);
    return async (call) => {
      going += 1;
      peak = Math.max(peak, going);
      await release.promise;
      going -= 1;
      return issue(call);
    };
  });
  const all = Promise.all(Array.from({ length: 80 }, (_, index) => tokens.get(id(1000 + index))));
  await vi.waitFor(() => {
    expect(going).toBe(50);
  });
  release.resolve(undefined);
  expect(await all).toHaveLength(80);
  expect(peak).toBe(50);
});
