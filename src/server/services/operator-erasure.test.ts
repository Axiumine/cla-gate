// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { columnsHolding, listAccount, snapshots } from '../adapters/db/erasure-fixture/test-support.ts';
import { runOperatorErasure } from './operator-erasure.ts';
import {
  ACTOR,
  BYSTANDER,
  callFor,
  erasureAudit,
  erasureWorld,
  failStatement,
  footprintRead,
  operator,
  othersOf,
  recordSql,
  replaceWithNoOp,
  rowsOf,
  signAs,
  snapshotOf,
  TARGET,
  target,
} from './operator-erasure-fixture/test-support.ts';
import { eraseInInstallation } from './operator-erasure-queries.ts';

// The operator's erasure over every installation (E22-S05): what it decides, what it calls, and what it leaves.

/** `expect.any` is typed `any`; as `unknown` it can sit in an object literal. */
const ANY_STRING: unknown = expect.any(String);
const DRY = { githubId: target, actor: operator, execute: false } as const;
const REAL = { githubId: target, actor: operator, execute: true } as const;

test('a GitHub id the server never saw is unknown, for a dry run and for a real run, and nothing is called', async () => {
  const { db } = await erasureWorld();
  const { plugin, statements } = recordSql();
  const watched = db.withPlugin(plugin);
  const stranger = parseGithubId(1);
  expect(await runOperatorErasure(watched, { ...DRY, githubId: stranger })).toEqual({ kind: 'unknown' });
  expect(await runOperatorErasure(watched, { ...REAL, githubId: stranger })).toEqual({ kind: 'unknown' });
  expect(statements.some((text) => text.includes('erase_signer_pii'))).toBe(false);
  expect(await erasureAudit(db)).toEqual([]);
});

test('a dry run reports the footprint and changes nothing', async () => {
  const { db, t1, t2 } = await erasureWorld();
  const before = await othersOf(db, TARGET);
  const outcome = await runOperatorErasure(db, DRY);
  expect(outcome).toEqual({
    kind: 'dry_run',
    before: {
      known: true,
      scrubbed: false,
      installations: [
        { installationId: t1.installationId, signatures: 1, signerPiiRows: 1, loginSnapshots: 0 },
        { installationId: t2.installationId, signatures: 1, signerPiiRows: 1, loginSnapshots: 0 },
      ],
    },
  });
  expect(await rowsOf(db, TARGET)).toHaveLength(2);
  expect(await snapshotOf(db, TARGET)).toEqual({
    login: 'login-4242',
    name: 'Name 4242',
    avatar_url: ANY_STRING,
  });
  expect(await erasureAudit(db)).toEqual([]);
  expect(await othersOf(db, TARGET)).toEqual(before);
});

test('a real run calls the function once per installation of the person, each in a transaction of its own, and nowhere else', async () => {
  const { db, t1, t2 } = await erasureWorld();
  const { plugin, statements } = recordSql();
  const watched = db.withPlugin(plugin);
  const transaction = vi.spyOn(watched, 'transaction');
  expect(await runOperatorErasure(watched, REAL)).toMatchObject({
    kind: 'erased',
    erased: [
      { installationId: t1.installationId, deleted: 1 },
      { installationId: t2.installationId, deleted: 1 },
    ],
  });
  expect(transaction).toHaveBeenCalledTimes(2);
  expect(statements.filter((text) => text.includes('erase_signer_pii'))).toHaveLength(2);
  expect((await erasureAudit(db)).map((row) => row.installation_id)).toEqual([t1.installationId, t2.installationId]);
});

test('a real run leaves no row of personal data, a scrubbed snapshot, no session, and every signature core as it was', async () => {
  const { db, t1, t2 } = await erasureWorld();
  const cores = await db.selectFrom('signatures').selectAll().orderBy('id').execute();
  expect(await runOperatorErasure(db, REAL)).toMatchObject({ kind: 'erased' });
  expect(await rowsOf(db, TARGET)).toEqual([]);
  expect(await snapshotOf(db, TARGET)).toEqual({ login: 'erased-4242', name: null, avatar_url: null });
  expect(await db.selectFrom('signatures').selectAll().orderBy('id').execute()).toEqual(cores);
  expect(await erasureAudit(db)).toEqual([
    {
      installation_id: t1.installationId,
      actor_github_id: ACTOR,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: TARGET,
      metadata: { signer_pii_rows: 1 },
    },
    {
      installation_id: t2.installationId,
      actor_github_id: ACTOR,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: TARGET,
      metadata: { signer_pii_rows: 1 },
    },
  ]);
});

test('erasing a person leaves the rows of other people in the same tenants, and the tenant they never signed in, as they were', async () => {
  const { db } = await erasureWorld();
  const before = await othersOf(db, TARGET);
  expect(await runOperatorErasure(db, REAL)).toMatchObject({ kind: 'erased' });
  expect(await othersOf(db, TARGET)).toEqual(before);
  expect(await rowsOf(db, BYSTANDER)).toHaveLength(2);
  expect((await snapshotOf(db, BYSTANDER)).login).toBe('login-5353');
});

test('the name, the email and the login of the person are in no column of the database afterwards, the audit rows included', async () => {
  const data = { name: 'Zzzz Unique Name', email: 'zzzz.unique@mail.test', login: 'zzzz-unique-login' };
  const { db } = await erasureWorld(data);
  expect(await columnsHolding(db, Object.values(data))).toContain('signer_pii.name');
  expect(await runOperatorErasure(db, REAL)).toMatchObject({ kind: 'erased' });
  expect(await columnsHolding(db, Object.values(data))).toEqual([]);
  expect(JSON.stringify(await db.selectFrom('audit_log').selectAll().execute())).not.toContain('zzzz');
});

test('a person who is erased already is nothing to erase: the function is not called and no audit row is written', async () => {
  const { db } = await erasureWorld();
  await runOperatorErasure(db, REAL);
  const { plugin, statements } = recordSql();
  const audit = await erasureAudit(db);
  expect(await runOperatorErasure(db.withPlugin(plugin), REAL)).toEqual({ kind: 'nothing' });
  expect(await runOperatorErasure(db.withPlugin(plugin), DRY)).toEqual({ kind: 'nothing' });
  expect(statements.some((text) => text.includes('erase_signer_pii'))).toBe(false);
  expect(await erasureAudit(db)).toEqual(audit);
});

test('a person erased by the org admins of both tenants is nothing to erase either', async () => {
  const { db, t1, t2 } = await erasureWorld();
  await eraseInInstallation(db, { githubId: target, actor: operator }, t1.installationId);
  await eraseInInstallation(db, { githubId: target, actor: operator }, t2.installationId);
  expect(await runOperatorErasure(db, REAL)).toEqual({ kind: 'nothing' });
  expect(await erasureAudit(db)).toHaveLength(2);
});

test('a person with signatures and no personal data stored is scrubbed by a real run, with an audit row that counts no row', async () => {
  const { db, t3 } = await erasureWorld();
  await signAs(db, t3, 7777, null);
  const outcome = await runOperatorErasure(db, { ...REAL, githubId: parseGithubId(7777) });
  expect(outcome).toMatchObject({ kind: 'erased', erased: [{ installationId: t3.installationId, deleted: 0 }] });
  expect(await snapshotOf(db, 7777)).toEqual({ login: 'erased-7777', name: null, avatar_url: null });
  expect((await erasureAudit(db)).map((row) => row.metadata)).toEqual([{ signer_pii_rows: 0 }]);
});

test('a person who signed nowhere cannot be scrubbed: the real run finds the snapshot as it was and reports the mismatch', async () => {
  const { db } = await erasureWorld();
  await db.insertInto('users').values({ github_id: 8888, login: 'login-8888', name: null, avatar_url: null }).execute();
  const request = { ...REAL, githubId: parseGithubId(8888) };
  const outcome = await runOperatorErasure(db, request);
  expect(outcome).toMatchObject({ kind: 'mismatch', after: { scrubbed: false, installations: [] } });
  expect(await erasureAudit(db)).toEqual([]);
});

test('the login of the person on the allowlist of an installation where they signed nothing is cleared too, and the audit row counts no signer_pii row there', async () => {
  const { db, t1, t2, t3 } = await erasureWorld();
  await listAccount(db, t3, TARGET, 'zzzz-target-login');
  await listAccount(db, t3, BYSTANDER, 'zzzz-bystander-login');
  const outcome = await runOperatorErasure(db, REAL);
  expect(outcome).toMatchObject({
    kind: 'erased',
    erased: [
      { installationId: t1.installationId, deleted: 1 },
      { installationId: t2.installationId, deleted: 1 },
      { installationId: t3.installationId, deleted: 0 },
    ],
  });
  expect(await snapshots(db)).toEqual([
    { installation_id: t3.installationId, github_id: TARGET, login_snapshot: null },
    { installation_id: t3.installationId, github_id: BYSTANDER, login_snapshot: 'zzzz-bystander-login' },
  ]);
  expect((await erasureAudit(db)).map((row) => [row.installation_id, row.metadata])).toEqual([
    [t1.installationId, { signer_pii_rows: 1 }],
    [t2.installationId, { signer_pii_rows: 1 }],
    [t3.installationId, { signer_pii_rows: 0 }],
  ]);
  expect(await runOperatorErasure(db, REAL)).toEqual({ kind: 'nothing' });
});

test('a dry run counts the login on an allowlist and a real run is not "nothing" while one is left, though no signer_pii row is', async () => {
  const { db, t1, t2, t3 } = await erasureWorld();
  await eraseInInstallation(db, { githubId: target, actor: operator }, t1.installationId);
  await eraseInInstallation(db, { githubId: target, actor: operator }, t2.installationId);
  await listAccount(db, t3, TARGET, 'zzzz-target-login');
  const dry = await runOperatorErasure(db, DRY);
  expect(dry.kind).toBe('dry_run');
  expect(dry.kind === 'dry_run' ? dry.before.installations.filter((entry) => entry.loginSnapshots > 0) : []).toEqual([
    { installationId: t3.installationId, signatures: 0, signerPiiRows: 0, loginSnapshots: 1 },
  ]);
  expect(await runOperatorErasure(db, REAL)).toMatchObject({ kind: 'erased' });
  expect(await snapshots(db)).toEqual([
    { installation_id: t3.installationId, github_id: TARGET, login_snapshot: null },
  ]);
});

test('a function that leaves the login on an allowlist is caught by the check after the loop', async () => {
  const { db, t3 } = await erasureWorld();
  await listAccount(db, t3, TARGET, 'zzzz-target-login');
  await replaceWithNoOp(db);
  expect(await runOperatorErasure(db, REAL)).toMatchObject({ kind: 'mismatch' });
});

test('a call that fails stops the loop, names the installations done and pending, and leaves the done ones done', async () => {
  const { db, t1, t2 } = await erasureWorld();
  const failure = Object.assign(new Error('connection lost'), { code: '08006' });
  const watched = db.withPlugin(failStatement(callFor(t2.installationId), 1, failure));
  const outcome = await runOperatorErasure(watched, REAL);
  expect(outcome).toEqual({ kind: 'failed', done: [t1.installationId], pending: [t2.installationId], cause: failure });
  expect((await rowsOf(db, TARGET)).map(([installationId]) => installationId)).toEqual([t2.installationId]);
  expect((await snapshotOf(db, TARGET)).login).toBe('login-4242');
  expect((await erasureAudit(db)).map((row) => row.installation_id)).toEqual([t1.installationId]);
});

test('a failure of the first call leaves every installation pending and changes nothing', async () => {
  const { db, t1, t2 } = await erasureWorld();
  const before = await othersOf(db, TARGET);
  const watched = db.withPlugin(failStatement(callFor(t1.installationId), 1, new Error('down')));
  expect(await runOperatorErasure(watched, REAL)).toMatchObject({
    kind: 'failed',
    done: [],
    pending: [t1.installationId, t2.installationId],
  });
  expect(await rowsOf(db, TARGET)).toHaveLength(2);
  expect(await erasureAudit(db)).toEqual([]);
  expect(await othersOf(db, TARGET)).toEqual(before);
});

test('the run that follows a failure finishes the erasure: the installation that was done is called again and deletes nothing', async () => {
  const { db, t1, t2 } = await erasureWorld();
  await runOperatorErasure(db.withPlugin(failStatement(callFor(t2.installationId), 1, new Error('down'))), REAL);
  const outcome = await runOperatorErasure(db, REAL);
  expect(outcome).toMatchObject({
    kind: 'erased',
    erased: [
      { installationId: t1.installationId, deleted: 0 },
      { installationId: t2.installationId, deleted: 1 },
    ],
  });
  expect(await rowsOf(db, TARGET)).toEqual([]);
  expect((await snapshotOf(db, TARGET)).login).toBe('erased-4242');
  expect((await erasureAudit(db)).map((row) => [row.installation_id, row.metadata])).toEqual([
    [t1.installationId, { signer_pii_rows: 1 }],
    [t1.installationId, { signer_pii_rows: 0 }],
    [t2.installationId, { signer_pii_rows: 1 }],
  ]);
});

test('a failure of the read after the loop is a failure with every installation done and none pending', async () => {
  const { db, t1, t2 } = await erasureWorld();
  const failure = new Error('gone');
  const watched = db.withPlugin(failStatement(footprintRead, 2, failure));
  expect(await runOperatorErasure(watched, REAL)).toEqual({
    kind: 'failed',
    done: [t1.installationId, t2.installationId],
    pending: [],
    cause: failure,
  });
  expect(await rowsOf(db, TARGET)).toEqual([]);
});

test('a failure of the first read is thrown and nothing was changed', async () => {
  const { db } = await erasureWorld();
  const failure = new Error('no database');
  await expect(runOperatorErasure(db.withPlugin(failStatement(footprintRead, 1, failure)), REAL)).rejects.toBe(failure);
  expect(await rowsOf(db, TARGET)).toHaveLength(2);
});

test('a function that erases nothing is caught by the check after the loop: the rows left and the snapshot are reported', async () => {
  const { db, t1, t2 } = await erasureWorld();
  await replaceWithNoOp(db);
  const outcome = await runOperatorErasure(db, REAL);
  expect(outcome).toMatchObject({
    kind: 'mismatch',
    after: {
      scrubbed: false,
      installations: [
        { installationId: t1.installationId, signatures: 1, signerPiiRows: 1, loginSnapshots: 0 },
        { installationId: t2.installationId, signatures: 1, signerPiiRows: 1, loginSnapshots: 0 },
      ],
    },
  });
});

test('the data a hostile-named person holds is erased like any other', async () => {
  const { db } = await erasureWorld({
    name: "=cmd|' /C calc'!A0",
    email: 'x@example.test',
    login: "Robert'); DROP TABLE users;--",
  });
  expect(await runOperatorErasure(db, REAL)).toMatchObject({ kind: 'erased' });
  expect(await rowsOf(db, TARGET)).toEqual([]);
  expect(await db.selectFrom('users').select('id').execute()).not.toEqual([]);
});
