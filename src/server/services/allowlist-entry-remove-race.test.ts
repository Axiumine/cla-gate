// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { backendPid, realPostgresOnly, waitUntilBlocked, withConnections } from '../adapters/db/test-support.ts';
import { removeAllowlistEntry } from './allowlist-entry-remove.ts';
import { removalWorld } from './allowlist-removal-fixture/test-support.ts';
import { sentJobs } from './jobs-fixture/test-support.ts';
import { brokenBy } from './publish-fixture/test-support.ts';

// Removing an allowlist entry while others act on it (E14-S07), on a real server. The order is decided by the row locks and
// `pg_locks`, never by a timer. PGlite has one session, so the races run in the CI `postgres` job only; the checks themselves are
// shown in sequence below and in allowlist-entry-remove.test.ts.

/** The world with the plain repository of tenant 1 enforcing, so that a removal of an entry that covers the installation sends one sweep. */
async function enforcingWorld() {
  const base = await removalWorld();
  const { db, t1 } = base;
  await db
    .updateTable('repositories')
    .set({ enabled: false })
    .where('installation_id', '=', t1.installationId)
    .execute();
  await db.updateTable('repositories').set({ enabled: true }).where('id', '=', t1.plain.repositoryId).execute();
  return base;
}

test('three removals of one entry one after the other give one success, two not_found, one audit row and one sweep, on whatever engine runs the suite', async () => {
  const { db, run, t1, audited } = await enforcingWorld();
  const answers = [await brokenBy(run(t1.entryId)), await brokenBy(run(t1.entryId)), await brokenBy(run(t1.entryId))];
  expect(answers).toEqual([null, { rule: 'not_found', details: undefined }, { rule: 'not_found', details: undefined }]);
  expect(await audited()).toBe(1);
  expect((await sentJobs(db)).map((sent) => sent.job.type)).toEqual(['sweep-repository']);
});

realPostgresOnly(
  'five simultaneous removals of one entry give one success and four not_found, one audit row and one sweep',
  async () => {
    const { db, t1, scope, enqueuer, admin, audited } = await enforcingWorld();
    const connections = withConnections(5);
    const request = { entryId: t1.entryId, role: 'org_admin', actorGithubId: admin.githubId } as const;
    const answers = await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        brokenBy(removeAllowlistEntry({ db: connections.get(index), enqueuer }, scope, request)),
      ),
    );
    expect(answers.filter((answer) => answer === null)).toHaveLength(1);
    expect(answers.filter((answer) => answer?.rule === 'not_found')).toHaveLength(4);
    expect(await db.selectFrom('allowlist_entries').select('id').where('id', '=', t1.entryId).execute()).toEqual([]);
    expect(await audited()).toBe(1);
    expect((await sentJobs(db)).map((sent) => sent.job.type)).toEqual(['sweep-repository']);
  },
);

realPostgresOnly(
  'a removal by an admin of a repository that waits for the repository row reads the document a CLA change left under that lock, and is refused',
  async () => {
    const { db, t1, scope, enqueuer, admin, entryFor, remaining } = await enforcingWorld();
    const { repositoryId, documentId } = t1.scoped;
    await db.updateTable('repositories').set({ cla_document_id: documentId }).where('id', '=', repositoryId).execute();
    const entry = await entryFor(repositoryId);
    const connections = withConnections(2);
    const holder = connections.get(0);
    const waiting = connections.get(1);
    const waitingPid = await backendPid(waiting);
    await sql`begin`.execute(holder);
    await sql`select id from repositories where id = ${repositoryId} for update`.execute(holder);
    await holder
      .updateTable('repositories')
      .set({ cla_document_id: t1.documentId })
      .where('id', '=', repositoryId)
      .execute();
    const removing = brokenBy(
      removeAllowlistEntry({ db: waiting, enqueuer }, scope, {
        entryId: entry,
        role: 'repo_admin',
        actorGithubId: admin.githubId,
      }),
    );
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await removing).toEqual({ rule: 'forbidden', details: undefined });
    expect(await remaining()).toContain(entry);
  },
);
