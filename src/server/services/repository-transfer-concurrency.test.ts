// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createInstallationSync } from './installation-sync.ts';
import {
  A_INSTALLATION,
  auditRows,
  B_INSTALLATION,
  moveShared,
  OTHER_ACCOUNT,
  repositoryRows,
  SHARED,
  transferWorld,
} from './sync-fixture/test-support.ts';

// Two tenants syncing at the same moment after a repository moved between them (E05-S09). The release of A's row by B's
// transaction and A's own removal of it are conditional updates of one row, so one of them writes and audits it and the
// other finds nothing to do, and neither waits for the other in a cycle. PGlite has one session, so only a real server
// can make the two overlap.

const id = parseGithubId;
const FIVE = Array.from({ length: 5 }, (_, index) => index);

test('A and B syncing concurrently after a transfer end with one active row for the repository and one removal under A', async () => {
  const world = await transferWorld();
  moveShared(world);
  const fresh = () =>
    createInstallationSync({
      db: world.db,
      github: world.fake,
      admission: world.admissionFor([OTHER_ACCOUNT]),
      clock: world.clock,
      logger: world.logger,
    });
  const runs = FIVE.flatMap(() => [
    fresh().syncInstallation(id(A_INSTALLATION)),
    fresh().syncInstallation(id(B_INSTALLATION)),
  ]);
  await Promise.all(runs);
  const rows = (await repositoryRows(world.db)).filter((row) => row.github_repo_id === SHARED);
  expect(rows.map((row) => [row.installation_id === world.bId, row.removed_at === null])).toEqual([
    [false, false],
    [true, true],
  ]);
  const trail = (await auditRows(world.db)).filter((row) => row.subject_id === SHARED);
  expect(trail.map((row) => [row.installation_id === world.bId, row.action])).toEqual(
    expect.arrayContaining([
      [false, 'repository.removed'],
      [true, 'repository.added'],
    ]),
  );
  expect(trail.filter((row) => row.action === 'repository.removed')).toHaveLength(1);
  expect(trail.filter((row) => row.action === 'repository.added' && row.installation_id === world.bId)).toHaveLength(1);
});
