// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { realPostgresOnly } from '../db/test-support.ts';
import { COMMIT, jobsOf, overrideWorld, recordAs, storedOverrides } from './commit-override-fixture/test-support.ts';
import { auditRows } from './document-fixture/test-support.ts';

// Simultaneous records of one override (E15-S05), over HTTP, on a real server: the unique key `(repository, commit)` lets exactly one
// through, which alone writes the audit row; the others find the override and are `409 override_exists`. PGlite has one connection,
// so its requests are served one after the other and cannot race; the sequential case is in commit-override-rules.test.ts.

test('two records one after the other give a 201 and a 409, one row and one audit row, on whatever engine runs the suite', async () => {
  const world = await overrideWorld();
  const first = await recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT);
  const second = await recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT);
  expect([first.statusCode, second.statusCode]).toEqual([201, 409]);
  expect(await storedOverrides(world)).toHaveLength(1);
  expect(await auditRows(world, 'commit_override.created')).toHaveLength(1);
});

realPostgresOnly(
  'five simultaneous identical records give one 201 and four 409, one row, one audit row and no second job, every round',
  async () => {
    const world = await overrideWorld();
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT)),
    );
    expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([201, 409, 409, 409, 409]);
    expect(await storedOverrides(world)).toHaveLength(1);
    expect(await auditRows(world, 'commit_override.created')).toHaveLength(1);
    expect(await jobsOf(world, 'evaluate-pr')).toEqual([]);
  },
);
