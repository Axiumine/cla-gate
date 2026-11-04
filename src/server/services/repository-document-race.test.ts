// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  backendPid,
  publishVersion,
  realPostgresOnly,
  waitUntilBlocked,
  withConnections,
} from '../adapters/db/test-support.ts';
import { brokenBy, publishWorld } from './publish-fixture/test-support.ts';
import { changeRepositoryDocument } from './repository-document-attach.ts';

// Two changes of the CLA of one repository (E14-S02) on a real server. The order is decided by a row lock and `pg_locks`, never by a
// timer: one session holds the repository row in an open transaction and changes the pointer, the change of the other session waits
// for it, and what that change finds when the holder commits is what its checks decide on. PGlite has one session, so the races run
// in the CI `postgres` job only; the checks themselves are shown in sequence in repository-document-attach.test.ts, and the first
// test here is the same change with nothing in its way, on whatever engine runs the suite.

/** The world of the tests below: the repository document of tenant 1 is published, so only the role or the order can refuse an attach of it. */
async function publishedWorld() {
  const world = await publishWorld();
  const { db, t1 } = world;
  const version = await publishVersion(db, t1.scoped.documentId, t1.publisherId, {
    major: 1,
    minor: 0,
    text: 'Terms\n',
  });
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', t1.scoped.documentId)
    .execute();
  return world;
}

async function raceWorld() {
  const world = await publishedWorld();
  const { t1 } = world;
  const connections = withConnections(2);
  const holder = connections.get(0);
  const waiting = connections.get(1);
  const waitingPid = await backendPid(waiting);
  /** Opens a transaction on the holder's session that holds the repository row and points it at `documentId`. */
  const holdAndPoint = async (documentId: number) => {
    await sql`begin`.execute(holder);
    await sql`select id from repositories where id = ${t1.scoped.repositoryId} for update`.execute(holder);
    await holder
      .updateTable('repositories')
      .set({ cla_document_id: documentId })
      .where('id', '=', t1.scoped.repositoryId)
      .execute();
  };
  return { ...world, waiting, waitingPid, holder, holdAndPoint };
}

test('with nothing in its way the admin of a repository attaches its published document: the pointer moves and the audit row has no previous document', async () => {
  const { db, t1, scope, enqueuer, people } = await publishedWorld();
  const change = await brokenBy(
    changeRepositoryDocument(db, scope, enqueuer, {
      repositoryId: t1.scoped.repositoryId,
      role: 'repo_admin',
      actorGithubId: people.repoAdmin1.githubId,
      documentId: t1.scoped.documentId,
    }),
  );
  expect(change).toBeNull();
  const [audit] = await db
    .selectFrom('audit_log')
    .select('metadata')
    .where('action', '=', 'repository.cla_document_attached')
    .execute();
  expect(audit?.metadata).toEqual({
    repository_id: t1.scoped.repositoryId,
    document_id: t1.scoped.documentId,
    previous_document_id: null,
  });
});

realPostgresOnly(
  "a change that waits for the repository row of one that wins is judged against what the winner left: an admin of the repository cannot swap the organisation's document they find there",
  async () => {
    const world = await raceWorld();
    const { db, t1, scope, enqueuer } = world;
    await world.holdAndPoint(t1.documentId);
    const change = brokenBy(
      changeRepositoryDocument(world.waiting, scope, enqueuer, {
        repositoryId: t1.scoped.repositoryId,
        role: 'repo_admin',
        actorGithubId: world.people.repoAdmin1.githubId,
        documentId: t1.scoped.documentId,
      }),
    );
    await waitUntilBlocked(db, world.waitingPid);
    await sql`commit`.execute(world.holder);
    expect(await change).toEqual({ rule: 'forbidden', details: undefined });
    const stored = await db
      .selectFrom('repositories')
      .select('cla_document_id')
      .where('id', '=', t1.scoped.repositoryId)
      .executeTakeFirstOrThrow();
    expect(stored.cla_document_id).toBe(t1.documentId);
    expect(
      await db.selectFrom('audit_log').select('id').where('action', '=', 'repository.cla_document_attached').execute(),
    ).toEqual([]);
  },
);

realPostgresOnly(
  'a change that waits for the repository row reads the pointer the winner set: its audit row names that document as the previous one, and its sweep is sent after it',
  async () => {
    const world = await raceWorld();
    const { db, t1, scope, enqueuer } = world;
    await world.holdAndPoint(t1.documentId);
    const change = brokenBy(
      changeRepositoryDocument(world.waiting, scope, enqueuer, {
        repositoryId: t1.scoped.repositoryId,
        role: 'org_admin',
        actorGithubId: world.people.admin1.githubId,
        documentId: t1.scoped.documentId,
      }),
    );
    await waitUntilBlocked(db, world.waitingPid);
    await sql`commit`.execute(world.holder);
    expect(await change).toBeNull();
    const [audit] = await db
      .selectFrom('audit_log')
      .select('metadata')
      .where('action', '=', 'repository.cla_document_attached')
      .execute();
    expect(audit?.metadata).toEqual({
      repository_id: t1.scoped.repositoryId,
      document_id: t1.scoped.documentId,
      previous_document_id: t1.documentId,
    });
  },
);
