// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import {
  type CachedVerdict,
  createOrgMembershipCache,
  MAX_CACHED_VERDICTS,
  MEMBER_TTL_MS,
  NOT_MEMBER_TTL_MS,
} from './org-membership-cache.ts';
import { FakeClock } from './test-support.ts';

// The memory of the membership lookup (E07-S10): how long each verdict is believed, to the millisecond, who shares an
// entry (nobody but the same person in the same installation), and what goes first when it is full.

const INSTALLATION = parseGithubId(5000);
const PERSON = parseGithubId(77);
const id = parseGithubId;

function cacheWorld() {
  const clock = new FakeClock('2026-11-02T10:00:00Z');
  return { clock, cache: createOrgMembershipCache(clock) };
}

test('the limits are the ones of the story: 10 minutes for a member, 2 for a non-member, 10,000 entries', () => {
  expect([MEMBER_TTL_MS, NOT_MEMBER_TTL_MS, MAX_CACHED_VERDICTS]).toEqual([600_000, 120_000, 10_000]);
});

test.each<[verdict: CachedVerdict, ttlMs: number]>([
  ['member', 600_000],
  ['not_member', 120_000],
])('a %s is believed until the last millisecond before its %i ms are over, and not at the last', (verdict, ttlMs) => {
  const { clock, cache } = cacheWorld();
  cache.set(INSTALLATION, PERSON, verdict);
  expect(cache.get(INSTALLATION, PERSON)).toBe(verdict);
  clock.advance(ttlMs - 1);
  expect(cache.get(INSTALLATION, PERSON)).toBe(verdict);
  clock.advance(1);
  expect(cache.get(INSTALLATION, PERSON)).toBeUndefined();
});

test('an expired verdict stays gone: a later read does not bring it back', () => {
  const { clock, cache } = cacheWorld();
  cache.set(INSTALLATION, PERSON, 'not_member');
  clock.advance(NOT_MEMBER_TTL_MS);
  expect(cache.get(INSTALLATION, PERSON)).toBeUndefined();
  expect(cache.get(INSTALLATION, PERSON)).toBeUndefined();
});

test('reading a verdict does not extend it: the time counts from the moment it was stored', () => {
  const { clock, cache } = cacheWorld();
  cache.set(INSTALLATION, PERSON, 'member');
  clock.advance(MEMBER_TTL_MS - 1000);
  expect(cache.get(INSTALLATION, PERSON)).toBe('member');
  clock.advance(1000);
  expect(cache.get(INSTALLATION, PERSON)).toBeUndefined();
});

test('storing a verdict again replaces the earlier one and starts its time again, with the time of the new verdict', () => {
  const { clock, cache } = cacheWorld();
  cache.set(INSTALLATION, PERSON, 'member');
  clock.advance(MEMBER_TTL_MS - 1);
  cache.set(INSTALLATION, PERSON, 'not_member');
  expect(cache.get(INSTALLATION, PERSON)).toBe('not_member');
  clock.advance(NOT_MEMBER_TTL_MS - 1);
  expect(cache.get(INSTALLATION, PERSON)).toBe('not_member');
  clock.advance(1);
  expect(cache.get(INSTALLATION, PERSON)).toBeUndefined();
});

test.each<[name: string, installation: number, person: number]>([
  ['the same person in another installation', 5001, 77],
  ['another person in the same installation', 5000, 78],
  ['the same two ids the other way round', 77, 5000],
  ['ids that read the same when written side by side', 50_007, 7],
])('%s has no verdict of its own: nothing is shared across the pair', (_name, installation, person) => {
  const { cache } = cacheWorld();
  cache.set(INSTALLATION, PERSON, 'member');
  expect(cache.get(id(installation), id(person))).toBeUndefined();
  cache.set(id(installation), id(person), 'not_member');
  expect(cache.get(INSTALLATION, PERSON)).toBe('member');
  expect(cache.get(id(installation), id(person))).toBe('not_member');
});

/** A cache holding {@link MAX_CACHED_VERDICTS} verdicts: person 1 stored first, person 10,000 last, all in installation 1. */
function fullCache() {
  const world = cacheWorld();
  for (let person = 1; person <= MAX_CACHED_VERDICTS; person += 1) {
    world.cache.set(id(1), id(person), 'member');
  }
  return world;
}

test('10,000 verdicts all fit: none is pushed out before the limit is passed', () => {
  const { cache } = fullCache();
  const held = Array.from({ length: MAX_CACHED_VERDICTS }, (_, index) => cache.get(id(1), id(index + 1)));
  expect(held.every((verdict) => verdict === 'member')).toBe(true);
});

test('the one pushed out is the least recently stored when none was read', () => {
  const { cache } = fullCache();
  cache.set(id(1), id(MAX_CACHED_VERDICTS + 1), 'member');
  expect(cache.get(id(1), id(1))).toBeUndefined();
  expect(cache.get(id(1), id(2))).toBe('member');
  expect(cache.get(id(1), id(MAX_CACHED_VERDICTS + 1))).toBe('member');
});

test('reading a verdict makes it the most recently used: the next one in line goes instead', () => {
  const { cache } = fullCache();
  expect(cache.get(id(1), id(1))).toBe('member');
  cache.set(id(1), id(MAX_CACHED_VERDICTS + 1), 'member');
  expect(cache.get(id(1), id(1))).toBe('member');
  expect(cache.get(id(1), id(2))).toBeUndefined();
  expect(cache.get(id(1), id(3))).toBe('member');
});

test('storing a verdict that is already held evicts nobody, and makes it the most recently used', () => {
  const { cache } = fullCache();
  cache.set(id(1), id(1), 'member');
  expect(cache.get(id(1), id(2))).toBe('member');
  expect(cache.get(id(1), id(MAX_CACHED_VERDICTS))).toBe('member');
  cache.set(id(1), id(MAX_CACHED_VERDICTS + 1), 'member');
  expect(cache.get(id(1), id(1))).toBe('member');
});

test('a full cache stays at 10,000: after many more stores only the latest 10,000 are held', () => {
  const { cache } = fullCache();
  for (let person = MAX_CACHED_VERDICTS + 1; person <= MAX_CACHED_VERDICTS + 50; person += 1) {
    cache.set(id(1), id(person), 'member');
  }
  const held = Array.from({ length: MAX_CACHED_VERDICTS + 50 }, (_, index) => cache.get(id(1), id(index + 1)));
  expect(held.filter((verdict) => verdict !== undefined)).toHaveLength(MAX_CACHED_VERDICTS);
  expect(held.slice(0, 50)).toEqual(Array.from({ length: 50 }, () => undefined));
});
