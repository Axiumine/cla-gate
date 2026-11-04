// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { backendPid, realPostgresOnly, waitUntilBlocked, withConnections } from '../adapters/db/test-support.ts';
import { sentJobs } from './jobs-fixture/test-support.ts';
import { publishWorld } from './publish-fixture/test-support.ts';
import { type Disabled, disableRepository } from './repository-disablement.ts';

// Turning a repository off while others act on it (E14-S04), on a real server. The order is decided by the lock of the repository
// row and `pg_locks`, never by a timer. PGlite has one session, so the races run in the CI `postgres` job only; the checks themselves
// are shown in sequence in repository-disablement.test.ts. (The app worlds of the route tests are PGlite always, so the races of the
// call are made here, on connections of their own.)

/** Tenant 1's plain repository on and pointing at the installation-wide document, and the request of an org admin to turn it off. */
async function onWorld() {
  const base = await publishWorld();
  const { t1, people } = base;
  await base.db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId, enabled: true })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const request = {
    repositoryId: t1.plain.repositoryId,
    role: 'org_admin',
    actorGithubId: people.admin1.githubId,
  } as const;
  return { ...base, request };
}

test('five calls one after the other give one changed true, one audit row and one finalise-repository job, on whatever engine runs the suite', async () => {
  const { db, scope, enqueuer, request } = await onWorld();
  const answers: Disabled[] = [];
  for (let call = 0; call < 5; call += 1) {
    answers.push(await disableRepository(db, scope, enqueuer, request));
  }
  expect(answers.map((answer) => answer.changed)).toEqual([true, false, false, false, false]);
  expect(
    await db.selectFrom('audit_log').select('id').where('action', '=', 'repository.disabled').execute(),
  ).toHaveLength(1);
  expect((await sentJobs(db)).map((sent) => sent.job.type)).toEqual(['finalise-repository']);
});

realPostgresOnly(
  'five simultaneous calls give one changed true and four changed false, one audit row and one finalise-repository job',
  async () => {
    const { db, t1, scope, enqueuer, request } = await onWorld();
    const connections = withConnections(5);
    const answers = await Promise.all(
      [0, 1, 2, 3, 4].map((index) => disableRepository(connections.get(index), scope, enqueuer, request)),
    );
    expect(answers.map((answer) => answer.changed).toSorted((a, b) => Number(a) - Number(b))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    const stored = await db
      .selectFrom('repositories')
      .select('enabled')
      .where('id', '=', t1.plain.repositoryId)
      .executeTakeFirstOrThrow();
    expect(stored.enabled).toBe(false);
    expect(
      await db.selectFrom('audit_log').select('id').where('action', '=', 'repository.disabled').execute(),
    ).toHaveLength(1);
    expect((await sentJobs(db)).map((sent) => sent.job.type)).toEqual(['finalise-repository']);
  },
);

realPostgresOnly(
  'a disable that waits for the repository row of a change that wins reads the flag that change left: it finds the repository on, turns it off and sends the job',
  async () => {
    const { db, t1, scope, enqueuer, request } = await onWorld();
    await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.plain.repositoryId).execute();
    const connections = withConnections(2);
    const holder = connections.get(0);
    const waiting = connections.get(1);
    const waitingPid = await backendPid(waiting);
    await sql`begin`.execute(holder);
    await sql`select id from repositories where id = ${t1.plain.repositoryId} for update`.execute(holder);
    await holder.updateTable('repositories').set({ enabled: true }).where('id', '=', t1.plain.repositoryId).execute();
    const disabling = disableRepository(waiting, scope, enqueuer, request);
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await disabling).toEqual({ enabled: false, changed: true });
    const stored = await db
      .selectFrom('repositories')
      .select('enabled')
      .where('id', '=', t1.plain.repositoryId)
      .executeTakeFirstOrThrow();
    expect(stored.enabled).toBe(false);
    expect((await sentJobs(db)).map((sent) => sent.job.type)).toEqual(['finalise-repository']);
  },
);
