// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { type LookupContext, RoleCache } from './role-cache.ts';
import { deferred, roleKey } from './role-fixture/test-support.ts';
import { FakeClock } from './test-support.ts';

// Whether a lookup is still the current one of its key (E11-S07 asks it before it writes the ledger): true from the start
// until a fresh lookup displaces it or an invalidation drops it, and it never changes the answer the lookup gives.

const KEY = roleKey(1, 501);

function setup() {
  const cache = new RoleCache({ clock: new FakeClock('2026-11-02T10:00:00.000Z') });
  /** A lookup held open by hand, with what it was told about being current at the start, and a way to ask again later. */
  const held = (answer: boolean) => {
    const gate = deferred<boolean>();
    const told: { context?: LookupContext } = {};
    const load = (context: LookupContext) => {
      told.context = context;
      return gate.promise.then(() => answer);
    };
    const release = (): void => {
      gate.resolve(true);
    };
    return { load, release, told };
  };
  return { cache, held };
}

const currentOf = (told: { context?: LookupContext }): boolean | undefined => told.context?.isCurrent();

test('a lookup is current while it waits, and still when it ends alone', async () => {
  const { cache, held } = setup();
  const only = held(true);
  const answer = cache.resolve(KEY, only.load);
  await Promise.resolve();
  expect(currentOf(only.told)).toBe(true);
  only.release();
  expect(await answer).toBe(true);
});

test('a fresh lookup displaces the one under way: the older is not current, the newer is, and both answer their callers', async () => {
  const { cache, held } = setup();
  const older = held(true);
  const newer = held(false);
  const first = cache.resolve(KEY, older.load);
  const second = cache.resolve(KEY, newer.load, { fresh: true });
  expect([currentOf(older.told), currentOf(newer.told)]).toEqual([false, true]);
  older.release();
  newer.release();
  expect([await first, await second]).toEqual([true, false]);
});

test('a caller that joins a lookup under way does not start another, and the lookup stays current', async () => {
  const { cache, held } = setup();
  const only = held(true);
  const first = cache.resolve(KEY, only.load);
  const joined = cache.resolve(KEY, () => Promise.reject(new Error('a joiner must not run its own lookup')));
  expect(currentOf(only.told)).toBe(true);
  only.release();
  expect([await first, await joined]).toEqual([true, true]);
});

test.each([
  [
    'the person',
    (cache: RoleCache) => {
      cache.invalidateViewer(parseGithubId(501));
    },
  ],
  [
    'the installation',
    (cache: RoleCache) => {
      cache.invalidateInstallation(KEY.installationId);
    },
  ],
  [
    'everything',
    (cache: RoleCache) => {
      cache.invalidateAll();
    },
  ],
])('a lookup under way is not current once %s is invalidated, and still answers its caller', async (_what, drop) => {
  const { cache, held } = setup();
  const only = held(true);
  const answer = cache.resolve(KEY, only.load);
  drop(cache);
  expect(currentOf(only.told)).toBe(false);
  only.release();
  expect(await answer).toBe(true);
  expect(cache.size).toBe(0);
});

test('the lookup of another person is not touched by the invalidation of this one', async () => {
  const { cache, held } = setup();
  const other = held(true);
  const answer = cache.resolve(roleKey(1, 502), other.load);
  cache.invalidateViewer(parseGithubId(501));
  expect(currentOf(other.told)).toBe(true);
  other.release();
  expect(await answer).toBe(true);
});
