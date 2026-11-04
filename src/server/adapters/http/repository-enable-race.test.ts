// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { realPostgresOnly } from '../db/test-support.ts';
import { repositoryState } from './repository-document-fixture/test-support.ts';
import {
  enableAs,
  enabledAnswerOf,
  enabledAuditRows,
  enableWorld,
  sweeps,
} from './repository-enable-fixture/test-support.ts';

// Simultaneous calls that turn one repository on (E14-S03), over HTTP, on a real server: exactly one is `changed: true`, and it alone
// writes the audit row and sends the sweep. PGlite has one connection, so its requests are served one after the other and cannot race;
// the sequential case (a second call finds the repository on) is in repository-enable-routes.test.ts, and the order of an enable and a
// detach, decided by the lock of the repository row and not by luck, is in repository-enablement-race.test.ts.

test('two calls one after the other give a changed true and a changed false, one audit row and one sweep job, on whatever engine runs the suite', async () => {
  const world = await enableWorld();
  const first = await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  const second = await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([enabledAnswerOf(first).changed, enabledAnswerOf(second).changed]).toEqual([true, false]);
  expect(await enabledAuditRows(world, world.t1.plain.githubRepoId)).toHaveLength(1);
  expect(await sweeps(world)).toHaveLength(1);
});

realPostgresOnly(
  'five simultaneous calls give one changed true and four changed false, one audit row and one sweep job, every round',
  async () => {
    const world = await enableWorld();
    const { t1 } = world;
    const people = ['admin1', 'admin1', 'admin1', 'admin1', 'admin1'] as const;
    const answers = await Promise.all(people.map((who) => enableAs(world, who, t1.plain.repositoryId)));
    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const changes = answers.map((answer) => enabledAnswerOf(answer).changed).toSorted((a, b) => Number(a) - Number(b));
    expect(changes).toEqual([false, false, false, false, true]);
    expect((await repositoryState(world, t1.plain.repositoryId)).enabled).toBe(true);
    expect(await enabledAuditRows(world, t1.plain.githubRepoId)).toHaveLength(1);
    expect(await sweeps(world)).toHaveLength(1);
  },
);
