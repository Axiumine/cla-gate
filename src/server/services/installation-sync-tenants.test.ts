// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { InsertQueryNode, type KyselyPlugin, ValuesNode } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createInstallationSync } from './installation-sync.ts';
import { findActiveRepositoryByGithubId } from './repository-queries.ts';
import {
  auditRows,
  failRepositoryInsert,
  installationRows,
  OWNER,
  remoteInstallation,
  remoteRepositories,
  remoteRepository,
  repositoryRows,
  rowIdOf,
  type SyncWorld,
  syncWorld,
} from './sync-fixture/test-support.ts';

// Every query of a sync names its installation, so a sync of one tenant never reaches the rows of another (E05-S08).

const id = parseGithubId;
const OTHER_ACCOUNT = 5000;

/** Tenants A (installation 11, the owner) and B (installation 12, the allowed account), both synced with three repositories. */
async function twoTenants() {
  const world = await syncWorld([OTHER_ACCOUNT]);
  world.fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 3));
  world.fake.addInstallation(remoteInstallation(12, OTHER_ACCOUNT), remoteRepositories(200, 3));
  await world.sync.syncInstallation(id(11));
  await world.sync.syncInstallation(id(12));
  return world;
}

/** Everything stored for tenant B: its installation row, its repositories and its audit rows. */
async function tenantB(world: SyncWorld) {
  const installationId = await rowIdOf(world.db, 12);
  return {
    installation: (await installationRows(world.db)).find((row) => row.id === installationId),
    repositories: (await repositoryRows(world.db)).filter((row) => row.installation_id === installationId),
    audit: (await auditRows(world.db)).filter((row) => row.installation_id === installationId),
  };
}

/** What happens to tenant A on GitHub between two syncs. */
const CHANGES: readonly (readonly [label: string, change: (world: SyncWorld) => void])[] = [
  [
    'a new repository',
    (world) => {
      world.fake.setRepositories(id(11), remoteRepositories(100, 4));
    },
  ],
  [
    'a removed repository',
    (world) => {
      world.fake.setRepositories(id(11), remoteRepositories(100, 2));
    },
  ],
  [
    'a renamed repository',
    (world) => {
      world.fake.setRepositories(id(11), [remoteRepository(100, 'acme/renamed'), ...remoteRepositories(101, 2)]);
    },
  ],
  [
    'a suspension',
    (world) => {
      world.fake.suspend(id(11), new Date('2026-11-02T10:30:00Z'));
    },
  ],
  [
    'an uninstall',
    (world) => {
      world.fake.removeInstallation(id(11));
    },
  ],
];

test.each(CHANGES)('a sync of A after %s changes nothing of tenant B', async (_label, change) => {
  const world = await twoTenants();
  const before = await tenantB(world);
  world.clock.advance(60_000);
  change(world);
  expect((await world.sync.syncInstallation(id(11))).changed).toBe(true);
  expect(await tenantB(world)).toEqual(before);
});

test('once A no longer lists the shared repository, B stores it and the queries of each tenant see only their own row', async () => {
  const world = await syncWorld([OTHER_ACCOUNT]);
  const shared = remoteRepository(300, 'acme/shared');
  world.fake.addInstallation(remoteInstallation(11, OWNER), [...remoteRepositories(100, 2), shared]);
  world.fake.addInstallation(remoteInstallation(12, OTHER_ACCOUNT), [...remoteRepositories(200, 2), shared]);
  await world.sync.syncInstallation(id(11));
  world.fake.setRepositories(id(11), remoteRepositories(100, 2));
  await world.sync.syncInstallation(id(11));
  await world.sync.syncInstallation(id(12));
  const [a, b] = await installationRows(world.db);
  if (a === undefined || b === undefined) {
    throw new Error('the syncs stored no installation');
  }
  expect(await findActiveRepositoryByGithubId(world.db, a.id, id(300))).toBeNull();
  expect(await findActiveRepositoryByGithubId(world.db, b.id, id(300))).toMatchObject({ installation_id: b.id });
  const rowsOfA = (await repositoryRows(world.db)).filter(
    (row) => row.installation_id === a.id && row.github_repo_id === 300,
  );
  expect(rowsOfA).toHaveLength(1);
  expect(rowsOfA[0]?.removed_at).not.toBeNull();
});

/** Records the number of rows of every insert into `repositories`. */
function repositoryInsertSizes(sizes: number[]): KyselyPlugin {
  return {
    transformQuery: ({ node }) => {
      if (InsertQueryNode.is(node) && node.into?.table.identifier.name === 'repositories') {
        sizes.push(node.values !== undefined && ValuesNode.is(node.values) ? node.values.values.length : 0);
      }
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
}

test('a sync of 2,500 repositories writes them in batches of at most 500 rows', async () => {
  const world = await syncWorld();
  const sizes: number[] = [];
  const sync = createInstallationSync({
    db: world.db.withPlugin(repositoryInsertSizes(sizes)),
    github: world.fake,
    admission: world.admissionFor([]),
    clock: world.clock,
    logger: world.logger,
  });
  world.fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(1000, 2500));
  const outcome = await sync.syncInstallation(id(11));
  expect(outcome.repositories.added).toBe(2500);
  expect(sizes).toEqual([500, 500, 500, 500, 500]);
  expect(await repositoryRows(world.db)).toHaveLength(2500);
});

test('a failure in the last batch of 2,500 repositories leaves the whole sync unwritten: it is one transaction', async () => {
  const world = await syncWorld();
  const sync = createInstallationSync({
    db: world.db.withPlugin(failRepositoryInsert(5)),
    github: world.fake,
    admission: world.admissionFor([]),
    clock: world.clock,
    logger: world.logger,
  });
  world.fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(1000, 2500));
  await expect(sync.syncInstallation(id(11))).rejects.toThrow('disk full');
  const a = await rowIdOf(world.db, 11);
  expect((await repositoryRows(world.db)).filter((row) => row.installation_id === a)).toEqual([]);
  expect((await auditRows(world.db)).filter((row) => row.installation_id === a).map((row) => row.action)).toEqual([
    'installation.admitted',
  ]);
});
