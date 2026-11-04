// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { LOGIN_CACHE_MAX_ENTRIES, LOGIN_CACHE_TTL_MS, LoginCache } from './public-login-cache.ts';
import { FakeClock } from './test-support.ts';

// The memory of the public signature check (E22-S02): ten minutes, hits and misses alike, at most 10,000 logins, least recently used first.

const START = '2026-11-01T10:00:00Z';
const ID = parseGithubId(4711);
const OTHER = parseGithubId(4712);

test('the limits are ten minutes and 10,000 entries', () => {
  expect(LOGIN_CACHE_TTL_MS).toBe(10 * 60 * 1000);
  expect(LOGIN_CACHE_MAX_ENTRIES).toBe(10_000);
});

test('a login nothing is remembered for is undefined, which is not the answer null', () => {
  const cache = new LoginCache(new FakeClock(START));
  expect(cache.get('octocat')).toBeUndefined();
  cache.set('ghost', null);
  expect(cache.get('ghost')).toBeNull();
});

test('a hit and a miss are both remembered, and the login is compared without regard to its case', () => {
  const cache = new LoginCache(new FakeClock(START));
  cache.set('OctoCat', ID);
  cache.set('Ghost', null);
  expect(cache.get('octocat')).toBe(ID);
  expect(cache.get('OCTOCAT')).toBe(ID);
  expect(cache.get('ghost')).toBeNull();
});

test('an answer is kept for ten minutes from the moment it was stored: live a second before, gone at the minute, and a read does not extend it', () => {
  const clock = new FakeClock(START);
  const cache = new LoginCache(clock);
  cache.set('octocat', ID);
  clock.advance(LOGIN_CACHE_TTL_MS - 1000);
  expect(cache.get('octocat')).toBe(ID);
  clock.advance(999);
  expect(cache.get('octocat')).toBe(ID);
  clock.advance(1);
  expect(cache.get('octocat')).toBeUndefined();
});

test('an expired entry is removed by the read that finds it, and a new answer is kept for a full ten minutes', () => {
  const clock = new FakeClock(START);
  const cache = new LoginCache(clock);
  cache.set('octocat', ID);
  clock.advance(LOGIN_CACHE_TTL_MS);
  expect(cache.get('octocat')).toBeUndefined();
  cache.set('octocat', OTHER);
  clock.advance(LOGIN_CACHE_TTL_MS - 1);
  expect(cache.get('octocat')).toBe(OTHER);
});

test('storing a login again replaces the answer and restarts its ten minutes', () => {
  const clock = new FakeClock(START);
  const cache = new LoginCache(clock);
  cache.set('octocat', ID);
  clock.advance(LOGIN_CACHE_TTL_MS - 1000);
  cache.set('octocat', OTHER);
  clock.advance(LOGIN_CACHE_TTL_MS - 1000);
  expect(cache.get('octocat')).toBe(OTHER);
});

test('past the limit the least recently stored login goes first, and only as many as the limit are kept', () => {
  const cache = new LoginCache(new FakeClock(START), { maxEntries: 3 });
  for (const login of ['a1', 'a2', 'a3', 'a4', 'a5']) {
    cache.set(login, ID);
  }
  expect(['a1', 'a2', 'a3', 'a4', 'a5'].map((login) => cache.get(login))).toEqual([undefined, undefined, ID, ID, ID]);
});

test('a read makes an entry the most recently used one, so the entry that nobody asked for is the one that goes', () => {
  const cache = new LoginCache(new FakeClock(START), { maxEntries: 3 });
  cache.set('a1', ID);
  cache.set('a2', ID);
  cache.set('a3', ID);
  expect(cache.get('a1')).toBe(ID);
  cache.set('a4', ID);
  expect(['a1', 'a2', 'a3', 'a4'].map((login) => cache.get(login))).toEqual([ID, undefined, ID, ID]);
});

test('the default limit holds 10,000 logins and drops the oldest at the 10,001st', () => {
  const cache = new LoginCache(new FakeClock(START));
  for (let n = 0; n <= LOGIN_CACHE_MAX_ENTRIES; n += 1) {
    cache.set(`user${n}`, ID);
  }
  expect(cache.get('user0')).toBeUndefined();
  expect(cache.get('user1')).toBe(ID);
  expect(cache.get(`user${LOGIN_CACHE_MAX_ENTRIES}`)).toBe(ID);
});
