// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import { RoleCache } from './role-cache.ts';
import { deferred, roleKey, tenantId } from './role-fixture/test-support.ts';
import { ORG_SCOPE, type RoleKey, type RoleScope, repoScope } from './role-key.ts';
import { FakeClock } from './test-support.ts';

// The role cache (E11-S04) on a clock the test moves: the time to live to the millisecond, what is kept and what is not,
// the order things are forgotten in, single flight, `fresh` and the three ways to invalidate.

const START = '2026-11-02T10:00:00.000Z';
const KEY = roleKey(1, 501);

function setup(maxEntries?: number) {
  const clock = new FakeClock(START);
  const cache = new RoleCache({ clock, ...(maxEntries === undefined ? {} : { maxEntries }) });
  const loads: string[] = [];
  /** A lookup that answers `answer` and records that it ran. */
  const load = (answer: boolean, label = 'load') => {
    return () => {
      loads.push(label);
      return Promise.resolve(answer);
    };
  };
  return { clock, cache, loads, load };
}

test('a positive answer is a hit at 59.999 s and a miss at 60 s', async () => {
  const { clock, cache, loads, load } = setup();
  expect(await cache.resolve(KEY, load(true))).toBe(true);
  clock.advance(59_999);
  expect(await cache.resolve(KEY, load(false))).toBe(true);
  expect(loads).toEqual(['load']);
  clock.advance(1);
  expect(await cache.resolve(KEY, load(false))).toBe(false);
  expect(loads).toEqual(['load', 'load']);
});

test('a negative answer lives exactly as long: false at 59.999 s from the cache, then asked again at 60 s', async () => {
  const { clock, cache, loads, load } = setup();
  expect(await cache.resolve(KEY, load(false))).toBe(false);
  clock.advance(59_999);
  expect(await cache.resolve(KEY, load(true))).toBe(false);
  clock.advance(1);
  expect(await cache.resolve(KEY, load(true))).toBe(true);
  expect(loads).toEqual(['load', 'load']);
});

test('a hit does not extend the life of the answer: it is 60 s from the question, however often it is read', async () => {
  const { clock, cache, load } = setup();
  await cache.resolve(KEY, load(true));
  clock.advance(40_000);
  expect(await cache.resolve(KEY, load(false))).toBe(true);
  clock.advance(19_999);
  expect(await cache.resolve(KEY, load(false))).toBe(true);
  clock.advance(1);
  expect(await cache.resolve(KEY, load(false))).toBe(false);
});

test('the age of an answer counts from when its question was sent, not from when GitHub answered', async () => {
  const { clock, cache, load } = setup();
  const slow = deferred<boolean>();
  const asked = cache.resolve(KEY, () => slow.promise);
  clock.advance(30_000);
  slow.resolve(true);
  await asked;
  clock.advance(29_999);
  expect(await cache.resolve(KEY, load(false))).toBe(true);
  clock.advance(1);
  expect(await cache.resolve(KEY, load(false))).toBe(false);
});

test('an expired answer is forgotten when it is looked up, and an unread one stays until it is pushed out', async () => {
  const { clock, cache, load } = setup();
  await cache.resolve(roleKey(1, 501), load(true));
  await cache.resolve(roleKey(1, 502), load(true));
  clock.advance(60_000);
  expect(cache.size).toBe(2);
  await expect(cache.resolve(roleKey(1, 501), () => Promise.reject(new Error('GitHub is down')))).rejects.toThrow();
  expect(cache.size).toBe(1);
});

test('an error is never kept: the next caller asks again, and the failure is the one thrown', async () => {
  const { cache, loads, load } = setup();
  const failure = new Error('GitHub is down');
  await expect(
    cache.resolve(KEY, () => {
      loads.push('failing');
      return Promise.reject(failure);
    }),
  ).rejects.toBe(failure);
  expect(await cache.resolve(KEY, load(true))).toBe(true);
  expect(loads).toEqual(['failing', 'load']);
  expect(cache.size).toBe(1);
});

test('there is no stale-if-error: after the 60 s a failing GitHub fails the request, though the old answer is still held', async () => {
  const { clock, cache, load } = setup();
  await cache.resolve(KEY, load(true));
  clock.advance(60_000);
  const failure = new Error('GitHub is down');
  await expect(cache.resolve(KEY, () => Promise.reject(failure))).rejects.toBe(failure);
  expect(await cache.resolve(KEY, load(false))).toBe(false);
});

test('a lookup that throws at once is a rejection like any other, and nothing is left under way', async () => {
  const { cache, load } = setup();
  const failure = new Error('thrown, not rejected');
  await expect(
    cache.resolve(KEY, () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await cache.resolve(KEY, load(true))).toBe(true);
});

test.each([
  ['another installation', roleKey(2, 501), 'org'],
  ['another person', roleKey(1, 502), 'org'],
  ['a repository', roleKey(1, 501, repoScope(parseGithubId(77))), 'repo:77'],
  ['another repository', roleKey(1, 501, repoScope(parseGithubId(78))), 'repo:78'],
])('an answer for %s is not the answer for the key beside it', async (_name, other, scope) => {
  const { cache, loads, load } = setup();
  await cache.resolve(KEY, load(true, 'base'));
  expect(await cache.resolve(other, load(false, scope))).toBe(false);
  expect(await cache.resolve(KEY, load(false, 'again'))).toBe(true);
  expect(loads).toEqual(['base', scope]);
});

test('the scope is org, or repo: and the numeric GitHub id of the repository', () => {
  expect(ORG_SCOPE).toBe('org');
  expect(repoScope(parseGithubId(77))).toBe('repo:77');
});

test('the cache holds numeric ids and booleans: a key is two numbers and a scope, the answer a boolean', () => {
  expectTypeOf<RoleKey>().toEqualTypeOf<{
    readonly installationId: InstallationRowId;
    readonly viewerGithubId: GithubId;
    readonly scope: RoleScope;
  }>();
  expectTypeOf<RoleCache['resolve']>().returns.toEqualTypeOf<Promise<boolean>>();
  expectTypeOf<RoleScope>().toEqualTypeOf<'org' | `repo:${number}`>();
});

test('least recently used goes first: the answer nobody read is forgotten when the cache is full', async () => {
  const { cache, loads, load } = setup(3);
  for (const viewer of [1, 2, 3]) {
    await cache.resolve(roleKey(1, viewer), load(true, `viewer ${viewer}`));
  }
  await cache.resolve(roleKey(1, 1), load(true, 'viewer 1 again'));
  await cache.resolve(roleKey(1, 4), load(true, 'viewer 4'));
  expect(cache.size).toBe(3);
  await cache.resolve(roleKey(1, 1), load(true, 'viewer 1 again'));
  await cache.resolve(roleKey(1, 3), load(true, 'viewer 3 again'));
  await cache.resolve(roleKey(1, 4), load(true, 'viewer 4 again'));
  expect(loads).toEqual(['viewer 1', 'viewer 2', 'viewer 3', 'viewer 4']);
  await cache.resolve(roleKey(1, 2), load(true, 'viewer 2 again'));
  expect(loads).toEqual(['viewer 1', 'viewer 2', 'viewer 3', 'viewer 4', 'viewer 2 again']);
});

test('the default is 10 000 entries: the 10 001st pushes out the oldest, and only one', async () => {
  const { cache, loads, load } = setup();
  for (let viewer = 1; viewer <= 10_001; viewer += 1) {
    await cache.resolve(roleKey(1, viewer), load(true));
  }
  expect(cache.size).toBe(10_000);
  loads.length = 0;
  await cache.resolve(roleKey(1, 2), load(true));
  await cache.resolve(roleKey(1, 10_001), load(true));
  expect(loads).toEqual([]);
  await cache.resolve(roleKey(1, 1), load(true));
  expect(loads).toEqual(['load']);
});

test('a refresh of a kept answer is not a second entry', async () => {
  const { clock, cache, load } = setup(2);
  await cache.resolve(KEY, load(true));
  clock.advance(60_000);
  await cache.resolve(KEY, load(false));
  expect(cache.size).toBe(1);
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('a cache of %s entries is refused', (maxEntries) => {
  expect(() => new RoleCache({ clock: new FakeClock(START), maxEntries })).toThrow(RangeError);
});

test('twenty simultaneous identical lookups run one lookup and all get its answer', async () => {
  const { cache, loads } = setup();
  const gate = deferred<boolean>();
  const calls = Array.from({ length: 20 }, () =>
    cache.resolve(KEY, () => {
      loads.push('load');
      return gate.promise;
    }),
  );
  expect(loads).toEqual(['load']);
  gate.resolve(true);
  expect(await Promise.all(calls)).toEqual(Array.from({ length: 20 }, () => true));
  expect(loads).toEqual(['load']);
});

test('a failure goes to everyone who waited for it, is kept by nobody, and the next caller asks again', async () => {
  const { cache, loads, load } = setup();
  const gate = deferred<boolean>();
  const calls = Array.from({ length: 5 }, () =>
    cache.resolve(KEY, () => {
      loads.push('failing');
      return gate.promise;
    }),
  );
  const failure = new Error('GitHub is down');
  gate.reject(failure);
  const outcomes = await Promise.allSettled(calls);
  expect(outcomes).toEqual(Array.from({ length: 5 }, () => ({ status: 'rejected', reason: failure })));
  expect(await cache.resolve(KEY, load(true))).toBe(true);
  expect(loads).toEqual(['failing', 'load']);
});

test('lookups for different keys never wait on each other', async () => {
  const { cache, load } = setup();
  const slow = deferred<boolean>();
  const held = cache.resolve(roleKey(1, 501), () => slow.promise);
  expect(await cache.resolve(roleKey(2, 501), load(true))).toBe(true);
  expect(await cache.resolve(roleKey(1, 502), load(false))).toBe(false);
  expect(await cache.resolve(roleKey(1, 501, repoScope(parseGithubId(9))), load(true))).toBe(true);
  slow.resolve(false);
  expect(await held).toBe(false);
});

test('once a lookup is over, the next caller is a hit and not a waiter', async () => {
  const { cache, loads, load } = setup();
  await cache.resolve(KEY, load(true));
  expect(await cache.resolve(KEY, load(false))).toBe(true);
  expect(loads).toEqual(['load']);
});

test('fresh ignores the kept answer, asks again and replaces it', async () => {
  const { cache, loads, load } = setup();
  await cache.resolve(KEY, load(true, 'read'));
  expect(await cache.resolve(KEY, load(false, 'write'), { fresh: true })).toBe(false);
  expect(await cache.resolve(KEY, load(true, 'next read'))).toBe(false);
  expect(loads).toEqual(['read', 'write']);
});

test('fresh: false is a plain read', async () => {
  const { cache, loads, load } = setup();
  await cache.resolve(KEY, load(true));
  expect(await cache.resolve(KEY, load(false), { fresh: false })).toBe(true);
  expect(loads).toEqual(['load']);
});

test('fresh does not join a lookup under way: a write never takes an answer that was asked before it', async () => {
  const { cache, loads } = setup();
  const older = deferred<boolean>();
  const read = cache.resolve(KEY, () => older.promise);
  const write = cache.resolve(
    KEY,
    () => {
      loads.push('write');
      return Promise.resolve(false);
    },
    { fresh: true },
  );
  expect(await write).toBe(false);
  older.resolve(true);
  expect(await read).toBe(true);
  expect(loads).toEqual(['write']);
});

test('an older answer that arrives after a fresh one does not overwrite it', async () => {
  const { cache, load } = setup();
  const older = deferred<boolean>();
  const read = cache.resolve(KEY, () => older.promise);
  await cache.resolve(KEY, load(false), { fresh: true });
  older.resolve(true);
  await read;
  expect(await cache.resolve(KEY, load(true))).toBe(false);
});

test('a read that arrives while a fresh lookup is under way joins it', async () => {
  const { cache, loads } = setup();
  const gate = deferred<boolean>();
  const write = cache.resolve(KEY, () => gate.promise, { fresh: true });
  const read = cache.resolve(KEY, () => {
    loads.push('read');
    return Promise.resolve(true);
  });
  gate.resolve(false);
  expect([await write, await read, loads]).toEqual([false, false, []]);
});

test('a fresh lookup that fails leaves the kept answer and the failure goes to the caller', async () => {
  const { cache, load } = setup();
  await cache.resolve(KEY, load(true));
  const failure = new Error('GitHub is down');
  await expect(cache.resolve(KEY, () => Promise.reject(failure), { fresh: true })).rejects.toBe(failure);
  expect(await cache.resolve(KEY, load(false))).toBe(true);
});

test('invalidateViewer forgets that person in every installation and scope, and nobody else', async () => {
  const { cache, loads, load } = setup();
  const keys = [roleKey(1, 501), roleKey(2, 501), roleKey(1, 501, repoScope(parseGithubId(7))), roleKey(1, 502)];
  for (const key of keys) {
    await cache.resolve(key, load(true));
  }
  cache.invalidateViewer(parseGithubId(501));
  expect(cache.size).toBe(1);
  loads.length = 0;
  await cache.resolve(roleKey(1, 502), load(true));
  expect(loads).toEqual([]);
  await cache.resolve(roleKey(2, 501), load(true));
  expect(loads).toEqual(['load']);
});

test('invalidateInstallation forgets every person and scope of that installation, and no other', async () => {
  const { cache, loads, load } = setup();
  const keys = [roleKey(1, 501), roleKey(1, 502), roleKey(1, 501, repoScope(parseGithubId(7))), roleKey(2, 501)];
  for (const key of keys) {
    await cache.resolve(key, load(true));
  }
  cache.invalidateInstallation(tenantId(1));
  expect(cache.size).toBe(1);
  loads.length = 0;
  await cache.resolve(roleKey(2, 501), load(true));
  expect(loads).toEqual([]);
  await cache.resolve(roleKey(1, 502), load(true));
  expect(loads).toEqual(['load']);
});

test('invalidateAll forgets everything', async () => {
  const { cache, load } = setup();
  for (const key of [roleKey(1, 501), roleKey(2, 502)]) {
    await cache.resolve(key, load(true));
  }
  cache.invalidateAll();
  expect(cache.size).toBe(0);
});

test.each([
  [
    'viewer',
    (cache: RoleCache) => {
      cache.invalidateViewer(parseGithubId(501));
    },
  ],
  [
    'installation',
    (cache: RoleCache) => {
      cache.invalidateInstallation(tenantId(1));
    },
  ],
  [
    'all',
    (cache: RoleCache) => {
      cache.invalidateAll();
    },
  ],
])(
  'an invalidation by %s during a lookup keeps its answer from the cache, and a later caller starts a new lookup',
  async (_name, invalidate) => {
    const { cache, loads, load } = setup();
    const gate = deferred<boolean>();
    const waiting = cache.resolve(KEY, () => gate.promise);
    invalidate(cache);
    expect(await cache.resolve(KEY, load(false, 'after'))).toBe(false);
    gate.resolve(true);
    expect(await waiting).toBe(true);
    expect(await cache.resolve(KEY, load(true, 'again'))).toBe(false);
    expect(loads).toEqual(['after']);
  },
);

test('an invalidation of another person during a lookup changes nothing for it', async () => {
  const { cache, load } = setup();
  const gate = deferred<boolean>();
  const waiting = cache.resolve(KEY, () => gate.promise);
  cache.invalidateViewer(parseGithubId(999));
  cache.invalidateInstallation(tenantId(9));
  gate.resolve(true);
  await waiting;
  expect(await cache.resolve(KEY, load(false))).toBe(true);
});
