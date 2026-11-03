// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { backendPid, realPostgresOnly, waitUntilBlocked, withConnections } from '../adapters/db/test-support.ts';
import { sentJobs } from './jobs-fixture/test-support.ts';
import { brokenBy, publishWorld } from './publish-fixture/test-support.ts';
import { enableRepository } from './repository-enablement.ts';

// Turning a repository on while its CLA is being taken away (E14-S03) on a real server. The order is decided by a row lock and
// `pg_locks`, never by a timer: one session holds the repository row in an open transaction and detaches the document, the enable of
// the other session waits for it, and what that enable finds when the holder commits is what its checks decide on. A repository that
// enforces a CLA nobody can read must not exist, so the check that a CLA is attached and the flag that turns enforcement on are one
// step under the lock the detach takes too. PGlite has one session, so the race runs in the CI `postgres` job only; the checks
// themselves are shown in sequence in repository-enablement.test.ts.

test('with nothing in its way the enable of a repository with a published CLA turns it on, audits it and sends the sweep', async () => {
  const { db, t1, scope, enqueuer, people } = await publishWorld();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const answer = await enableRepository(db, scope, enqueuer, {
    repositoryId: t1.plain.repositoryId,
    role: 'org_admin',
    actorGithubId: people.admin1.githubId,
  });
  expect(answer).toEqual({ enabled: true, changed: true });
  expect((await sentJobs(db)).map((sent) => sent.job.type)).toEqual(['sweep-repository']);
});

realPostgresOnly(
  'an enable that waits for the repository row of a detach that wins finds no CLA: no_active_cla, the flag stays off, nothing is audited or sent',
  async () => {
    const { db, t1, scope, enqueuer, people } = await publishWorld();
    await db
      .updateTable('repositories')
      .set({ cla_document_id: t1.documentId })
      .where('id', '=', t1.plain.repositoryId)
      .execute();
    const connections = withConnections(2);
    const holder = connections.get(0);
    const waiting = connections.get(1);
    const waitingPid = await backendPid(waiting);
    await sql`begin`.execute(holder);
    await sql`select id from repositories where id = ${t1.plain.repositoryId} for update`.execute(holder);
    await holder
      .updateTable('repositories')
      .set({ cla_document_id: null })
      .where('id', '=', t1.plain.repositoryId)
      .execute();
    const enable = brokenBy(
      enableRepository(waiting, scope, enqueuer, {
        repositoryId: t1.plain.repositoryId,
        role: 'org_admin',
        actorGithubId: people.admin1.githubId,
      }),
    );
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect((await enable)?.rule).toBe('no_active_cla');
    const stored = await db
      .selectFrom('repositories')
      .select(['enabled', 'cla_document_id'])
      .where('id', '=', t1.plain.repositoryId)
      .executeTakeFirstOrThrow();
    expect([stored.enabled, stored.cla_document_id]).toEqual([false, null]);
    expect(await sentJobs(db)).toEqual([]);
  },
);
