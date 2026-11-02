// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import type { InstallationTokens } from './installation-tokens.ts';
import { tokenWorld } from './test-support.ts';
import { MAX_CACHED_TOKENS } from './token-cache.ts';

const key = testGitHubKey();
const id = parseGithubId;
const MINUTE = 60_000;

/** The ids from `first` to `last`, asked for in batches so that thousands of requests are not all in flight at once. */
async function getRange(tokens: InstallationTokens, first: number, last: number): Promise<void> {
  for (let from = first; from <= last; from += 100) {
    const to = Math.min(from + 99, last);
    await Promise.all(Array.from({ length: to - from + 1 }, (_unused, offset) => tokens.get(id(from + offset))));
  }
}

test('the cache is bounded at 1,000 entries', () => {
  expect(MAX_CACHED_TOKENS).toBe(1000);
});

test('with 1,000 live tokens a new installation takes the place of the oldest one, and the size stays 1,000', async () => {
  const { tokens, mints } = tokenWorld(key);
  await getRange(tokens, 1, 1000);
  expect(tokens.size).toBe(1000);
  await tokens.get(id(1001));
  expect(tokens.size).toBe(1000);
  expect(mints).toHaveLength(1001);
  await tokens.get(id(1000));
  await tokens.get(id(2));
  expect(mints).toHaveLength(1001);
  await tokens.get(id(1));
  expect(mints).toHaveLength(1002);
  expect(tokens.size).toBe(1000);
});

test('expired tokens are evicted first: live ones stay when room is needed', async () => {
  const { tokens, mints, clock } = tokenWorld(key);
  await getRange(tokens, 1, 500);
  clock.advance(40 * MINUTE);
  await getRange(tokens, 501, 1000);
  clock.advance(20 * MINUTE);
  expect(tokens.size).toBe(1000);
  await tokens.get(id(1001));
  expect(tokens.size).toBe(501);
  expect(mints).toHaveLength(1001);
  await getRange(tokens, 501, 1000);
  expect(mints).toHaveLength(1001);
});

test('a token that is about to expire is evicted before a live one', async () => {
  const { tokens, mints, clock } = tokenWorld(key);
  await getRange(tokens, 1, 999);
  clock.advance(58 * MINUTE);
  await tokens.get(id(1000));
  expect(tokens.size).toBe(1000);
  await tokens.get(id(1001));
  expect(tokens.size).toBe(2);
  await tokens.get(id(1000));
  expect(mints).toHaveLength(1001);
});

test('refreshing an installation that is already cached does not grow the cache', async () => {
  const { tokens, clock } = tokenWorld(key);
  await getRange(tokens, 1, 1000);
  clock.advance(56 * MINUTE);
  await tokens.get(id(500));
  expect(tokens.size).toBe(1000);
});
