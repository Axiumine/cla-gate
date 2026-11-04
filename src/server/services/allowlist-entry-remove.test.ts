// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { deleteFoundEntry } from './allowlist-entry-remove.ts';
import { removalWorld } from './allowlist-removal-fixture/test-support.ts';
import { jobCount } from './jobs-fixture/test-support.ts';
import { brokenBy, refuseAudit } from './publish-fixture/test-support.ts';

// Removing an allowlist entry below the routes (E14-S07): the role the service judges itself under the lock of the repository, which the
// guard of the route cannot do because it decides before the lock is held, what a simultaneous removal leaves, and what an abort leaves.

test('an admin of a repository is refused an entry that covers the installation, and nothing changes', async () => {
  const { run, t1, remaining, audited, db } = await removalWorld();
  const before = await remaining();
  expect(await brokenBy(run(t1.entryId, { role: 'repo_admin' }))).toEqual({ rule: 'forbidden', details: undefined });
  expect([await remaining(), await audited(), await jobCount(db)]).toEqual([before, 0, 0]);
});

test("an admin of a repository whom the guard let in is refused when the document attached by the time the lock is held is the organisation's", async () => {
  const { t1, db, run, repositoryEntry } = await removalWorld();
  const entry = await repositoryEntry(101);
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect(await brokenBy(run(entry, { role: 'repo_admin' }))).toEqual({ rule: 'forbidden', details: undefined });
  expect(await brokenBy(run(entry))).toBeNull();
});

test('an entry of a repository is removed by the admin of the repository when the document it enforces is its own', async () => {
  const { t1, db, run, entryFor, remaining } = await removalWorld();
  const entry = await entryFor(t1.scoped.repositoryId);
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.scoped.documentId })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  expect(await brokenBy(run(entry, { role: 'repo_admin' }))).toBeNull();
  expect(await remaining()).not.toContain(entry);
});

test('an entry of a repository that left the installation is for an org admin only', async () => {
  const { t1, db, run, repositoryEntry, remaining } = await removalWorld();
  const entry = await repositoryEntry(101);
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z'), enabled: false })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect(await brokenBy(run(entry, { role: 'repo_admin' }))).toEqual({ rule: 'forbidden', details: undefined });
  expect(await remaining()).toContain(entry);
  expect(await brokenBy(run(entry))).toBeNull();
  expect(await remaining()).not.toContain(entry);
});

test("an unknown entry and another tenant's entry are not_found, and the other tenant's row stays", async () => {
  const { t2, run, remaining } = await removalWorld();
  expect(await brokenBy(run(987_654))).toEqual({ rule: 'not_found', details: undefined });
  expect(await brokenBy(run(t2.entryId))).toEqual({ rule: 'not_found', details: undefined });
  expect(await remaining()).toContain(t2.entryId);
});

test('an entry that a simultaneous removal deleted between the find and the delete is not_found: no audit row, no job', async () => {
  const { db, scope, enqueuer, admin, t1, audited } = await removalWorld();
  await db.deleteFrom('allowlist_entries').where('id', '=', t1.entryId).execute();
  const phantom = {
    id: t1.entryId,
    repositoryId: null,
    repositoryRemovedAt: null,
    kind: 'user',
    githubId: admin.githubId,
  } as const;
  const attempt = db
    .transaction()
    .execute((trx) => deleteFoundEntry(trx, { scope, enqueuer, actorGithubId: admin.githubId }, phantom));
  expect(await brokenBy(attempt)).toEqual({ rule: 'not_found', details: undefined });
  expect([await audited(), await jobCount(db)]).toEqual([0, 0]);
});

test('an audit row that cannot be written rolls the delete back: the entry is still there, and so is the queue as it was', async () => {
  const { db, run, t1, remaining } = await removalWorld();
  await db.updateTable('repositories').set({ enabled: true }).where('id', '=', t1.plain.repositoryId).execute();
  await refuseAudit(db);
  await expect(run(t1.entryId)).rejects.toThrow(/audit refused/);
  expect(await remaining()).toContain(t1.entryId);
  expect(await jobCount(db)).toBe(0);
});

test('the removal asks GitHub nothing and touches no cache of GitHub facts: the services it runs through import neither the client port nor the membership cache', () => {
  const files = [
    'allowlist-entry-remove.ts',
    'allowlist-entry-checks.ts',
    'allowlist-entry-remove-queries.ts',
    'allowlist-sweeps.ts',
    'allowlist-entry-list.ts',
  ];
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a source file next to this one, named in the list above
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const imports = source.split('\n').filter((line) => line.startsWith('import '));
    expect(
      imports.filter((line) => /org-membership|ports\/github|octokit/.test(line)),
      file,
    ).toEqual([]);
  }
});
