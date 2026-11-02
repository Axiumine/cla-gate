// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { delay } from 'msw';
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { hourlyTokens, jwtSignedBy, tokenWorld } from './test-support.ts';

const key = testGitHubKey();
const MINUTE = 60_000;
const id = parseGithubId;

test('get mints a token for the installation with the App JWT and hands it out as a Secret', async () => {
  const { tokens, mints, clock } = tokenWorld(key);
  const issued = await tokens.get(id(7));
  expect(issued.token.reveal()).toBe('ghs_made-up-7-1');
  expect(issued.expiresAt).toEqual(new Date(clock.now().getTime() + 60 * MINUTE));
  expect(mints.map((call) => call.installationId)).toEqual(['7']);
  expect(jwtSignedBy(mints[0]?.jwt ?? '', key.publicKey)).toBe(true);
  expect(mints[0]?.body).toBe('');
});

test('a token requested at T and at T+54 minutes is one POST; at T+56 minutes there is a second', async () => {
  const { tokens, mints, clock } = tokenWorld(key);
  const first = await tokens.get(id(7));
  clock.advance(54 * MINUTE);
  const again = await tokens.get(id(7));
  expect(again.token.reveal()).toBe(first.token.reveal());
  expect(mints).toHaveLength(1);
  clock.advance(2 * MINUTE);
  const refreshed = await tokens.get(id(7));
  expect(mints).toHaveLength(2);
  expect(refreshed.token.reveal()).toBe('ghs_made-up-7-2');
  expect(refreshed.expiresAt.getTime()).toBe(Date.parse('2026-11-02T10:56:00.000Z') + 60 * MINUTE);
});

test.each([
  { after: '54 minutes', later: 54 * MINUTE, posts: 1 },
  { after: 'exactly 55 minutes, when five are left', later: 55 * MINUTE, posts: 1 },
  { after: '55 minutes and a millisecond', later: 55 * MINUTE + 1, posts: 2 },
  { after: 'an hour, when the token has just expired', later: 60 * MINUTE, posts: 2 },
  { after: 'two hours', later: 120 * MINUTE, posts: 2 },
])('requested again after $after the provider has made $posts POST(s) in all', async ({ later, posts }) => {
  const { tokens, mints, clock } = tokenWorld(key);
  await tokens.get(id(7));
  clock.advance(later);
  await tokens.get(id(7));
  expect(mints).toHaveLength(posts);
});

test('the refreshed token is cached in turn and replaces the old one', async () => {
  const { tokens, mints, clock } = tokenWorld(key);
  await tokens.get(id(7));
  clock.advance(56 * MINUTE);
  await tokens.get(id(7));
  clock.advance(54 * MINUTE);
  expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-2');
  expect(mints).toHaveLength(2);
  expect(tokens.size).toBe(1);
});

test('a token that GitHub issues with less than five minutes to live is served once and minted again next time', async () => {
  const { tokens, mints } = tokenWorld(key, (clock) => hourlyTokens(clock, 4 * MINUTE));
  expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-1');
  expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-2');
  expect(mints).toHaveLength(2);
});

test('50 concurrent calls for one installation produce exactly one POST, and all get that token', async () => {
  const { tokens, mints } = tokenWorld(key, (clock) => {
    const issue = hourlyTokens(clock);
    return async (call) => {
      await delay(50);
      return issue(call);
    };
  });
  const results = await Promise.all(Array.from({ length: 50 }, () => tokens.get(id(7))));
  expect(mints).toHaveLength(1);
  expect(new Set(results.map((issued) => issued.token.reveal()))).toEqual(new Set(['ghs_made-up-7-1']));
  await tokens.get(id(7));
  expect(mints).toHaveLength(1);
});

test('concurrent calls for two installations make one POST each', async () => {
  const { tokens, mints } = tokenWorld(key, (clock) => {
    const issue = hourlyTokens(clock);
    return async (call) => {
      await delay(30);
      return issue(call);
    };
  });
  const calls = Array.from({ length: 40 }, (_unused, index) => tokens.get(id(index % 2 === 0 ? 7 : 8)));
  const results = await Promise.all(calls);
  expect(mints.map((call) => call.installationId).toSorted((a, b) => a.localeCompare(b))).toEqual(['7', '8']);
  expect(results[0]?.token.reveal()).not.toBe(results[1]?.token.reveal());
  expect(results[0]?.token.reveal()).toBe(results[2]?.token.reveal());
});

test('an installation whose mint is stuck does not hold up another', async () => {
  const stuck = Promise.withResolvers<undefined>();
  const { tokens, mints } = tokenWorld(key, (clock) => {
    const issue = hourlyTokens(clock);
    return async (call) => {
      if (call.installationId === '7') {
        await stuck.promise;
      }
      return issue(call);
    };
  });
  let sevenDone = false;
  const seven = tokens.get(id(7)).then((issued) => {
    sevenDone = true;
    return issued;
  });
  await vi.waitFor(() => {
    expect(mints.map((call) => call.installationId)).toEqual(['7']);
  });
  expect((await tokens.get(id(8))).token.reveal()).toBe('ghs_made-up-8-1');
  expect(sevenDone).toBe(false);
  stuck.resolve(undefined);
  expect((await seven).token.reveal()).toBe('ghs_made-up-7-2');
});

test('invalidate drops the token, so the next call mints a new one', async () => {
  const { tokens, mints } = tokenWorld(key);
  await tokens.get(id(7));
  tokens.invalidate(id(7));
  expect(tokens.size).toBe(0);
  expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-2');
  expect(mints).toHaveLength(2);
});

test('invalidate touches only its own installation, and an unknown one is a no-op', async () => {
  const { tokens, mints } = tokenWorld(key);
  await tokens.get(id(7));
  await tokens.get(id(8));
  tokens.invalidate(id(7));
  tokens.invalidate(id(99));
  expect(tokens.size).toBe(1);
  expect((await tokens.get(id(8))).token.reveal()).toBe('ghs_made-up-8-2');
  expect(mints).toHaveLength(2);
});

test('after the concurrent calls are served the next refresh mints again: the single flight is not kept', async () => {
  const { tokens, mints, clock } = tokenWorld(key);
  await Promise.all(Array.from({ length: 5 }, () => tokens.get(id(7))));
  clock.advance(56 * MINUTE);
  await Promise.all(Array.from({ length: 5 }, () => tokens.get(id(7))));
  expect(mints).toHaveLength(2);
});
