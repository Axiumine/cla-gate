// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import {
  backendPid,
  migratedTestDatabase,
  realPostgresOnly,
  waitUntilBlocked,
  withConnections,
} from '../adapters/db/test-support.ts';
import { discardDraft, readDraft, saveDraft } from './cla-drafts.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// The race of two saves of one draft (E12-S03) at the statement level, on a real server. The order is decided by a row lock
// and `pg_locks`, never by a timer: one session holds the row (or the right to create it) in an open transaction, the
// second session's save waits for it, and what it finds when the first commits is what the guard in the statement decides.
// PGlite has one session, so the lock-ordered tests run in the CI `postgres` job only; the same outcomes are shown in
// sequence by the first test here, on whatever engine runs the suite, and in cla-drafts.test.ts.

async function setup() {
  const { db } = await migratedTestDatabase();
  const seeded = await twoTenants(db);
  const scope = { installationId: seeded.t1.installationId };
  const actor = { id: seeded.people.repoAdmin1.userId, githubId: seeded.people.repoAdmin1.githubId };
  return { db, seeded, scope, actor, documentId: seeded.t1.scoped.documentId };
}

/** The error of a rejected save, or null when it was accepted. */
async function conflictOf(attempt: Promise<unknown>) {
  try {
    await attempt;
    return null;
  } catch (error) {
    return error instanceof ClaRuleError ? { rule: error.rule, details: error.details } : error;
  }
}

test('two saves naming one revision, one after the other, are a save and a draft_conflict with the new revision', async () => {
  const { db, scope, actor, documentId } = await setup();
  const first = await saveDraft(db, scope, actor, { documentId, contentMd: 'First\n', expectedRevision: 1 });
  const second = await conflictOf(
    saveDraft(db, scope, actor, { documentId, contentMd: 'Second\n', expectedRevision: 1 }),
  );
  expect(first).toMatchObject({ revision: 2 });
  expect(second).toEqual({ rule: 'draft_conflict', details: { currentRevision: 2 } });
  expect(await readDraft(db, scope, documentId)).toMatchObject({ contentMd: 'First\n', revision: 2 });
});

realPostgresOnly(
  'a save that waits for the row of a save that wins finds the revision moved: draft_conflict with the new revision',
  async () => {
    const { db, scope, actor, documentId } = await setup();
    const connections = withConnections(2);
    const holder = connections.get(0);
    const waitingPid = await backendPid(connections.get(1));
    await sql`begin`.execute(holder);
    await sql`update cla_drafts set content_md = 'Winner' || chr(10), revision = revision + 1
    where document_id = ${documentId} and revision = 1`.execute(holder);
    const waiting = conflictOf(
      saveDraft(connections.get(1), scope, actor, { documentId, contentMd: 'Loser\n', expectedRevision: 1 }),
    );
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await waiting).toEqual({ rule: 'draft_conflict', details: { currentRevision: 2 } });
    expect(await readDraft(db, scope, documentId)).toMatchObject({ contentMd: 'Winner\n', revision: 2 });
    expect(await db.selectFrom('audit_log').select('id').where('action', '=', 'cla_draft.saved').execute()).toEqual([]);
  },
);

realPostgresOnly(
  "two creations of the first draft: the one that waits finds the other's row and is a draft_conflict at revision 1",
  async () => {
    const { db, scope, actor, documentId } = await setup();
    const connections = withConnections(2);
    await db.deleteFrom('cla_drafts').where('document_id', '=', documentId).execute();
    const holder = connections.get(0);
    const waitingPid = await backendPid(connections.get(1));
    await sql`begin`.execute(holder);
    await sql`insert into cla_drafts (document_id, installation_id, content_md, updated_by)
    select ${documentId}, ${scope.installationId}, 'First' || chr(10), ${actor.id}`.execute(holder);
    const waiting = conflictOf(
      saveDraft(connections.get(1), scope, actor, { documentId, contentMd: 'Second\n', expectedRevision: null }),
    );
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await waiting).toEqual({ rule: 'draft_conflict', details: { currentRevision: 1 } });
    expect(await readDraft(db, scope, documentId)).toMatchObject({ contentMd: 'First\n', revision: 1 });
  },
);

realPostgresOnly(
  'a save that waits for a discard finds no draft: draft_conflict with no current revision, and nothing is written',
  async () => {
    const { db, scope, actor, documentId } = await setup();
    const connections = withConnections(2);
    const holder = connections.get(0);
    const waitingPid = await backendPid(connections.get(1));
    await sql`begin`.execute(holder);
    await sql`delete from cla_drafts where document_id = ${documentId}`.execute(holder);
    const waiting = conflictOf(
      saveDraft(connections.get(1), scope, actor, { documentId, contentMd: 'Late\n', expectedRevision: 1 }),
    );
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await waiting).toEqual({ rule: 'draft_conflict', details: { currentRevision: null } });
    expect(await readDraft(db, scope, documentId)).toBeNull();
  },
);

realPostgresOnly(
  'a discard that waits for a save removes the draft the save wrote, and records the revision it removed',
  async () => {
    const { db, scope, actor, documentId } = await setup();
    const connections = withConnections(2);
    const holder = connections.get(0);
    const waitingPid = await backendPid(connections.get(1));
    await sql`begin`.execute(holder);
    await sql`update cla_drafts set revision = revision + 1 where document_id = ${documentId}`.execute(holder);
    const waiting = discardDraft(connections.get(1), scope, actor.githubId, documentId);
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    await waiting;
    expect(await readDraft(db, scope, documentId)).toBeNull();
    const audit = await db
      .selectFrom('audit_log')
      .select('metadata')
      .where('action', '=', 'cla_draft.discarded')
      .execute();
    expect(audit.map((row) => row.metadata)).toEqual([{ document_id: documentId, revision: 2 }]);
  },
);
