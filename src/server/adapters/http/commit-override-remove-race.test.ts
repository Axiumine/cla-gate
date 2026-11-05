// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { realPostgresOnly } from '../db/test-support.ts';
import {
  jobsOf,
  overridesIn,
  overrideWorld,
  removeOverrideAs,
  restingOnOverride,
} from './commit-override-fixture/test-support.ts';
import { auditRows } from './document-fixture/test-support.ts';

// Simultaneous removals of one override (E15-S06), over HTTP, on a real server: the repository lock lets one through, which alone deletes
// the row, writes the audit row and sends the jobs; the others find nothing and are `404`. PGlite has one connection, so its requests are
// served one after the other and cannot race; the sequential case runs on whatever engine runs the suite.

test('two removals one after the other give a 204 and a 404, one audit row and one job, on whatever engine runs the suite', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await restingOnOverride(world);
  const first = await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id);
  const second = await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id);
  expect([first.statusCode, second.statusCode]).toEqual([204, 404]);
  expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([]);
  expect(await auditRows(world, 'commit_override.deleted')).toHaveLength(1);
  expect(await jobsOf(world, 'evaluate-pr')).toHaveLength(1);
});

realPostgresOnly(
  'five simultaneous removals of one override give one 204 and four 404, one audit row and one job, every round',
  async () => {
    const world = await overrideWorld();
    const { t1 } = world;
    const id = await restingOnOverride(world);
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id)),
    );
    expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([204, 404, 404, 404, 404]);
    expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([]);
    expect(await auditRows(world, 'commit_override.deleted')).toHaveLength(1);
    expect(await jobsOf(world, 'evaluate-pr')).toHaveLength(1);
  },
);
