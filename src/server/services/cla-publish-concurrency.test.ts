// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  backendPid,
  realPostgresOnly,
  sha256,
  waitUntilBlocked,
  withConnections,
} from '../adapters/db/test-support.ts';
import { publishVersion } from './cla-publish.ts';
import { brokenBy, publication, publishText, publishWorld, versionsOf } from './publish-fixture/test-support.ts';

// The race of publishes of one document (E12-S04) at the statement level, on a real server. The order is decided by a row lock
// and `pg_locks`, never by a timer: one session holds the document row (or the draft row) in an open transaction, the publishes
// of the other sessions wait for it, and what they find when it ends is what the checks of the transaction decide. PGlite has one
// session, so the lock-ordered tests run in the CI `postgres` job only; the same outcome is shown in sequence by the first test
// here, on whatever engine runs the suite, and over HTTP in document-version-race.test.ts.

const HOLDER_TEXT = 'Published by the session that holds the row\n';

test('two publishes naming one active version, one after the other, are a version and a stale_active_version naming it', async () => {
  const world = await publishWorld();
  const { db, scoped } = world;
  const plan = await publication(world, scoped);
  const first = await publishVersion(db, world.scope, world.enqueuer, plan);
  const second = await brokenBy(publishVersion(db, world.scope, world.enqueuer, plan));
  expect(first.version).toMatchObject({ major: 1, minor: 0 });
  expect(second).toEqual({ rule: 'stale_active_version', details: { activeVersionId: first.version.id } });
  expect((await versionsOf(db, scoped)).map((row) => row.id)).toEqual([first.version.id]);
  // The refusal left the way open: a publish that names the version that is active now breaks no rule.
  expect(await brokenBy(publishText(world, scoped, 'Another text\n', { bump: 'minor' }))).toBeNull();
  expect((await versionsOf(db, scoped)).map((row) => `${row.major}.${row.minor}`)).toEqual(['1.0', '1.1']);
});

realPostgresOnly(
  'a publish that waits for the row of a publish that wins finds the pointer moved: stale_active_version, and nothing of it is written',
  async () => {
    const world = await publishWorld();
    const { db, scoped, scope, enqueuer } = world;
    const plan = await publication(world, scoped);
    const connections = withConnections(2);
    const holder = connections.get(0);
    const waitingPid = await backendPid(connections.get(1));
    await sql`begin`.execute(holder);
    await sql`select id from cla_documents where id = ${scoped} for update`.execute(holder);
    const winner = await holder
      .insertInto('cla_versions')
      .values({
        document_id: scoped,
        major: 1,
        minor: 0,
        content_md: HOLDER_TEXT,
        content_sha256: sha256(HOLDER_TEXT),
        published_by: world.admin.id,
        rationale: 'The winner',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await holder.updateTable('cla_documents').set({ active_version_id: winner.id }).where('id', '=', scoped).execute();
    const waiting = brokenBy(publishVersion(connections.get(1), scope, enqueuer, plan));
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await waiting).toEqual({ rule: 'stale_active_version', details: { activeVersionId: winner.id } });
    expect((await versionsOf(db, scoped)).map((row) => row.id)).toEqual([winner.id]);
    expect(
      await db.selectFrom('audit_log').select('id').where('action', '=', 'cla_version.published').execute(),
    ).toEqual([]);
    const draft = await db.selectFrom('cla_drafts').select('revision').where('document_id', '=', scoped).execute();
    expect(draft).toEqual([{ revision: 1 }]);
  },
);

realPostgresOnly(
  'a publish that waits for the draft that a save changes finds the revision moved: draft_conflict with the new revision',
  async () => {
    const world = await publishWorld();
    const { db, scoped, scope, enqueuer } = world;
    const plan = await publication(world, scoped);
    const connections = withConnections(2);
    const holder = connections.get(0);
    const waitingPid = await backendPid(connections.get(1));
    await sql`begin`.execute(holder);
    await holder
      .updateTable('cla_drafts')
      .set({ content_md: 'Saved while the publish waited\n', revision: 2 })
      .where('document_id', '=', scoped)
      .execute();
    const waiting = brokenBy(publishVersion(connections.get(1), scope, enqueuer, plan));
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await waiting).toEqual({ rule: 'draft_conflict', details: { currentRevision: 2 } });
    expect(await versionsOf(db, scoped)).toEqual([]);
    const draft = await db.selectFrom('cla_drafts').select('revision').where('document_id', '=', scoped).execute();
    expect(draft).toEqual([{ revision: 2 }]);
  },
);

realPostgresOnly(
  'five publishes that wait for one document row, let go together, are one version and four stale_active_version naming it',
  async () => {
    const world = await publishWorld();
    const { db, scoped, scope, enqueuer } = world;
    const plan = await publication(world, scoped);
    const connections = withConnections(6);
    const holder = connections.get(0);
    const publishers = [1, 2, 3, 4, 5].map((index) => connections.get(index));
    const pids = await Promise.all(publishers.map((publisher) => backendPid(publisher)));
    await sql`begin`.execute(holder);
    await sql`select id from cla_documents where id = ${scoped} for update`.execute(holder);
    const attempts = publishers.map((publisher) => brokenBy(publishVersion(publisher, scope, enqueuer, plan)));
    for (const pid of pids) {
      await waitUntilBlocked(db, pid);
    }
    await sql`rollback`.execute(holder);
    const outcomes = await Promise.all(attempts);
    const versions = await versionsOf(db, scoped);
    expect(versions.map((row) => `${row.major}.${row.minor}`)).toEqual(['1.0']);
    const stale = { rule: 'stale_active_version', details: { activeVersionId: versions[0]?.id } };
    expect(outcomes.toSorted((a, b) => Number(a === null) - Number(b === null))).toEqual([
      stale,
      stale,
      stale,
      stale,
      null,
    ]);
    expect(
      await db.selectFrom('audit_log').select('id').where('action', '=', 'cla_version.published').execute(),
    ).toHaveLength(1);
  },
);
