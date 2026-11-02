// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, inject, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { lockInstallation } from '../adapters/db/advisory-lock.ts';
import { openTestDatabase, realPostgresOnly } from '../adapters/db/test-support.ts';
import { createInstallationSync } from './installation-sync.ts';
import {
  auditActions,
  installationRows,
  OWNER,
  remoteInstallation,
  remoteRepositories,
  remoteRepository,
  repositoryRows,
  syncWorld,
} from './sync-fixture/test-support.ts';

// A per-installation advisory lock (pg_advisory_xact_lock) makes concurrent syncs take turns (E05-S08). PGlite has one
// session, where advisory locks are re-entrant and nothing can contend, so only a real server proves it.

const id = parseGithubId;
const TEN = Array.from({ length: 10 }, (_, index) => index);

/** Ten services on one database and one GitHub, as ten workers (or processes) would be: they share no in-process state. */
async function tenSyncs() {
  const world = await syncWorld();
  const syncs = TEN.map(() =>
    createInstallationSync({
      db: world.db,
      github: world.fake,
      admission: world.admissionFor([]),
      clock: world.clock,
      logger: world.logger,
    }),
  );
  return { ...world, syncs };
}

test('10 concurrent syncs of a new installation end with one row set and one audit row per transition', async () => {
  const { fake, syncs, db } = await tenSyncs();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 5));
  const outcomes = await Promise.all(syncs.map((sync) => sync.syncInstallation(id(11))));
  expect(outcomes.filter((outcome) => outcome.changed)).toHaveLength(1);
  expect(await installationRows(db)).toHaveLength(1);
  expect((await repositoryRows(db)).map((row) => row.github_repo_id)).toEqual([100, 101, 102, 103, 104]);
  expect(await auditActions(db)).toEqual([
    'installation.admitted',
    ...Array.from({ length: 5 }, () => 'repository.added'),
  ]);
});

test('10 concurrent syncs after a change apply it once: one audit row per transition', async () => {
  const { fake, syncs, db } = await tenSyncs();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 3));
  await syncs[0]?.syncInstallation(id(11));
  fake.setRepositories(id(11), [remoteRepository(100, 'acme/renamed'), remoteRepository(102), remoteRepository(300)]);
  fake.suspend(id(11), null);
  await Promise.all(syncs.map((sync) => sync.syncInstallation(id(11))));
  expect((await auditActions(db)).slice(4)).toEqual(['repository.added', 'repository.renamed', 'repository.removed']);
  expect((await repositoryRows(db)).map((row) => [row.github_repo_id, row.removed_at === null])).toEqual([
    [100, true],
    [101, false],
    [102, true],
    [300, true],
  ]);
});

test('10 concurrent syncs of a deleted installation mark it once', async () => {
  const { fake, syncs, db } = await tenSyncs();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 3));
  await syncs[0]?.syncInstallation(id(11));
  fake.removeInstallation(id(11));
  await Promise.all(syncs.map((sync) => sync.syncInstallation(id(11))));
  expect((await auditActions(db)).filter((action) => action === 'installation.deleted')).toHaveLength(1);
});

realPostgresOnly(
  'a sync waits while another session holds the lock of its installation, and not for another one',
  async () => {
    const { fake, sync, db } = await syncWorld();
    fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
    fake.addInstallation(remoteInstallation(12, OWNER), remoteRepositories(200, 1));
    const other = await openTestDatabase(inject('testDatabaseUrl'));
    let finished = false;
    let waiting: Promise<void> = Promise.resolve();
    await other.db.transaction().execute(async (holder) => {
      await lockInstallation(holder, id(11));
      waiting = sync.syncInstallation(id(11)).then(() => {
        finished = true;
      });
      await sync.syncInstallation(id(12));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(finished).toBe(false);
      expect(await installationRows(db)).toHaveLength(1);
    });
    await waiting;
    expect(finished).toBe(true);
    expect(await installationRows(db)).toHaveLength(2);
    await other.db.destroy();
  },
);
