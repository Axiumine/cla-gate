// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import {
  BYSTANDER,
  erasureAudit,
  erasureWorld,
  operator,
  rowsOf,
  STRANGER,
  signAs,
  snapshotOf,
  TARGET,
  target,
} from './operator-erasure-fixture/test-support.ts';
import { eraseInInstallation, readSignerFootprint } from './operator-erasure-queries.ts';
import { onRuntimeConnection } from './retention/test-support.ts';

// The two statements of the operator's erasure command (E22-S05): readSignerFootprint reads, eraseInInstallation calls
// erase_signer_pii. Both meet every tenant by design (tenant-registry-operator); what each answers for a person who signed in two
// tenants, for one who signed in one, and for one the server never saw, is here.

const id = parseGithubId;

test('the footprint of a person who signed in two tenants lists each with its signatures and its rows of personal data', async () => {
  const { db, t1, t2 } = await erasureWorld();
  expect(await readSignerFootprint(db, target)).toEqual({
    known: true,
    scrubbed: false,
    installations: [
      { installationId: t1.installationId, signatures: 1, signerPiiRows: 1 },
      { installationId: t2.installationId, signatures: 1, signerPiiRows: 1 },
    ],
  });
});

test('the footprint of a person who signed in one tenant lists that tenant only', async () => {
  const { db, t3 } = await erasureWorld();
  expect(await readSignerFootprint(db, id(STRANGER))).toEqual({
    known: true,
    scrubbed: false,
    installations: [{ installationId: t3.installationId, signatures: 1, signerPiiRows: 1 }],
  });
});

test('a signature without personal data counts as a core and not as a row, and a revoked signature still counts as a core', async () => {
  const { db, t3 } = await erasureWorld();
  const bare = await signAs(db, t3, 7777, null);
  await db
    .updateTable('signatures')
    .set({
      revoked_at: sql<Date>`signed_at + interval '1 minute'`,
      revoked_by: bare.userId,
      revoke_reason: 'signer_request',
    })
    .where('id', '=', bare.signatureId)
    .execute();
  expect(await readSignerFootprint(db, id(7777))).toEqual({
    known: true,
    scrubbed: false,
    installations: [{ installationId: t3.installationId, signatures: 1, signerPiiRows: 0 }],
  });
});

test('a person with a users row and no signature is known, has no installation, and is not scrubbed', async () => {
  const { db } = await erasureWorld();
  await db.insertInto('users').values({ github_id: 8888, login: 'login-8888', name: null, avatar_url: null }).execute();
  expect(await readSignerFootprint(db, id(8888))).toEqual({ known: true, scrubbed: false, installations: [] });
});

test('a GitHub id with no users row is unknown, whatever else the server holds', async () => {
  const { db, t1 } = await erasureWorld();
  await db
    .insertInto('allowlist_entries')
    .values({ installation_id: t1.installationId, kind: 'user', github_id: 8889, created_by: t1.publisherId })
    .execute();
  expect(await readSignerFootprint(db, id(8889))).toEqual({ known: false, scrubbed: false, installations: [] });
});

test('the snapshot counts as scrubbed only when the login is exactly erased-<github id>', async () => {
  const { db } = await erasureWorld();
  await db.updateTable('users').set({ login: 'erased-4243' }).where('github_id', '=', TARGET).execute();
  expect((await readSignerFootprint(db, target)).scrubbed).toBe(false);
  await db.updateTable('users').set({ login: 'erased-4242 ' }).where('github_id', '=', TARGET).execute();
  expect((await readSignerFootprint(db, target)).scrubbed).toBe(false);
  await db.updateTable('users').set({ login: 'erased-4242' }).where('github_id', '=', TARGET).execute();
  expect((await readSignerFootprint(db, target)).scrubbed).toBe(true);
});

test('the footprint of one person is not changed by the rows of another in the same tenants', async () => {
  const { db, t1, t2 } = await erasureWorld();
  expect((await readSignerFootprint(db, id(BYSTANDER))).installations).toEqual([
    { installationId: t1.installationId, signatures: 1, signerPiiRows: 1 },
    { installationId: t2.installationId, signatures: 1, signerPiiRows: 1 },
  ]);
});

test('eraseInInstallation deletes the rows of that installation only and answers how many', async () => {
  const { db, t1, t2 } = await erasureWorld();
  expect(await eraseInInstallation(db, { githubId: target, actor: operator }, t1.installationId)).toBe(1);
  expect((await rowsOf(db, TARGET)).map(([installationId]) => installationId)).toEqual([t2.installationId]);
  expect((await snapshotOf(db, TARGET)).login).toBe('login-4242');
  expect(await rowsOf(db, BYSTANDER)).toHaveLength(2);
});

test('eraseInInstallation writes the one audit row of the function, for the installation, the operator and the person, with a count and no personal data', async () => {
  const { db, t1 } = await erasureWorld();
  await eraseInInstallation(db, { githubId: target, actor: operator }, t1.installationId);
  expect(await erasureAudit(db)).toEqual([
    {
      installation_id: t1.installationId,
      actor_github_id: operator,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: TARGET,
      metadata: { signer_pii_rows: 1 },
    },
  ]);
});

test('eraseInInstallation for a tenant where the person has no rows deletes nothing and still scrubs nothing while they have rows elsewhere', async () => {
  const { db, t3, t1 } = await erasureWorld();
  expect(await eraseInInstallation(db, { githubId: target, actor: operator }, t3.installationId)).toBe(0);
  expect(await rowsOf(db, TARGET)).toHaveLength(2);
  expect((await snapshotOf(db, TARGET)).login).toBe('login-4242');
  expect((await erasureAudit(db)).map((row) => row.installation_id)).toEqual([t3.installationId]);
  expect(await eraseInInstallation(db, { githubId: target, actor: operator }, t1.installationId)).toBe(1);
});

test('eraseInInstallation fails for an installation that does not exist or a person the server never saw, and writes nothing', async () => {
  const { db, t1 } = await erasureWorld();
  await expect(
    eraseInInstallation(db, { githubId: target, actor: operator }, t1.installationId + 1000),
  ).rejects.toMatchObject({ code: 'P0002' });
  await expect(
    eraseInInstallation(db, { githubId: id(8890), actor: operator }, t1.installationId),
  ).rejects.toMatchObject({ code: 'P0002' });
  expect(await erasureAudit(db)).toEqual([]);
});

test('as the runtime role, the footprint is read and the function runs, while a direct delete of signer_pii is refused', async () => {
  const { db, t1 } = await erasureWorld();
  await onRuntimeConnection(db, async (connection) => {
    expect((await readSignerFootprint(connection, target)).installations).toHaveLength(2);
    await expect(sql`delete from signer_pii`.execute(connection)).rejects.toMatchObject({ code: '42501' });
    await expect(sql`update signer_pii set name = 'x'`.execute(connection)).rejects.toMatchObject({ code: '42501' });
    expect(await eraseInInstallation(connection, { githubId: target, actor: operator }, t1.installationId)).toBe(1);
  });
  expect(await rowsOf(db, TARGET)).toHaveLength(1);
});
