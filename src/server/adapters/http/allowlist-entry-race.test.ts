// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { realPostgresOnly } from '../db/test-support.ts';
import {
  addedEntries,
  addToInstallation,
  allowlistWorld,
  createdAuditRows,
  sweeps,
} from './allowlist-entry-fixture/test-support.ts';

// Simultaneous adds of one allowlist entry (E14-S06), over HTTP, on a real server: the unique key lets exactly one through, which alone
// writes the audit row and sends the sweeps; the others find the entry and are `409 allowlist_entry_exists`. PGlite has one connection,
// so its requests are served one after the other and cannot race; the sequential case is in allowlist-entry-routes.test.ts.

const BODY = { kind: 'user', login: 'ada-lovelace' } as const;

test('two adds one after the other give a 201 and a 409, one row, one audit row and one sweep per enforcing repository, on whatever engine runs the suite', async () => {
  const world = await allowlistWorld();
  const first = await addToInstallation(world, 'admin1', world.t1.installationId, BODY);
  const second = await addToInstallation(world, 'admin1', world.t1.installationId, BODY);
  expect([first.statusCode, second.statusCode]).toEqual([201, 409]);
  expect(await addedEntries(world)).toHaveLength(1);
  expect(await createdAuditRows(world)).toHaveLength(1);
  expect(await sweeps(world)).toHaveLength(1);
});

realPostgresOnly(
  'five simultaneous identical adds give one 201 and four 409, one row, one audit row and one sweep job, every round',
  async () => {
    const world = await allowlistWorld();
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => addToInstallation(world, 'admin1', world.t1.installationId, BODY)),
    );
    expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([201, 409, 409, 409, 409]);
    expect(await addedEntries(world)).toHaveLength(1);
    expect(await createdAuditRows(world)).toHaveLength(1);
    expect(await sweeps(world)).toHaveLength(1);
  },
);
