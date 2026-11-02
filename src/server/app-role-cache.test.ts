// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { RoleCache } from './services/role-cache.ts';
import { roleKey } from './services/role-fixture/test-support.ts';
import { FakeClock } from './services/test-support.ts';
import { testApp } from './test-support.ts';

// Where the application keeps its role cache (E11-S04): one per process, on `app.roleCache`, on the application's clock.

test('every application has a role cache of its own, empty at the start', async () => {
  const first = await testApp();
  const second = await testApp();
  expect(first.app.roleCache).toBeInstanceOf(RoleCache);
  expect(first.app.roleCache).not.toBe(second.app.roleCache);
  expect(first.app.roleCache.size).toBe(0);
});

test('a cache given to the application is the one it exposes', async () => {
  const roleCache = new RoleCache({ clock: new FakeClock('2026-11-02T10:00:00.000Z') });
  const { app } = await testApp({ roleCache });
  expect(app.roleCache).toBe(roleCache);
});

test('the default cache reads the time from the clock of the application: an answer is 60 s old when that clock says so', async () => {
  const clock = new FakeClock('2026-11-02T10:00:00.000Z');
  const { app } = await testApp({ clock });
  const asked: string[] = [];
  const load = () => {
    asked.push('GitHub');
    return Promise.resolve(true);
  };
  await app.roleCache.resolve(roleKey(1), load);
  clock.advance(59_999);
  await app.roleCache.resolve(roleKey(1), load);
  expect(asked).toHaveLength(1);
  clock.advance(1);
  await app.roleCache.resolve(roleKey(1), load);
  expect(asked).toHaveLength(2);
});
