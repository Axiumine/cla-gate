// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { admissionWorld, auditRows, githubInstallation, OWNER } from './admission-fixture/test-support.ts';
import { listed } from './store-fixture/test-support.ts';

const id = parseGithubId;

test('deciding on installation A never reads, writes or audits installation B', async () => {
  const { admissionFor, db, store } = await admissionWorld();
  const b = await admissionFor([]).admit(githubInstallation(22, OWNER));
  await store.upsertRepositories(b.installation.id, [listed(2, 1)]);
  const before = await db
    .selectFrom('installations')
    .selectAll()
    .where('id', '=', b.installation.id)
    .executeTakeFirst();
  const a = await admissionFor([]).admit(githubInstallation(11, 5000));
  await admissionFor([5000]).admit(githubInstallation(11, 5000));
  expect(
    await db.selectFrom('installations').selectAll().where('id', '=', b.installation.id).executeTakeFirst(),
  ).toEqual(before);
  expect(await store.findInstallationByGithubId(id(22))).toEqual(b.installation);
  expect(await db.selectFrom('repositories').select('installation_id').execute()).toEqual([
    { installation_id: b.installation.id },
  ]);
  const rows = await auditRows(db);
  expect(rows.filter((row) => row.installation_id === b.installation.id).map((row) => row.action)).toEqual([
    'installation.admitted',
  ]);
  expect(rows.filter((row) => row.installation_id === a.installation.id).map((row) => row.action)).toEqual([
    'installation.rejected',
    'installation.admitted',
  ]);
});

test('two installations of one account are two tenants: each has its own row and its own audit entries', async () => {
  const { admissionFor, db } = await admissionWorld();
  const first = await admissionFor([]).admit(githubInstallation(11, 5000));
  const second = await admissionFor([]).admit(githubInstallation(12, 5000));
  expect(first.installation.id).not.toBe(second.installation.id);
  expect((await auditRows(db)).map((row) => [row.installation_id, row.subject_id])).toEqual([
    [first.installation.id, 11],
    [second.installation.id, 12],
  ]);
});

test('ten concurrent decisions on one new installation write one row and one audit entry between them', async () => {
  const { admissionFor, db, logs } = await admissionWorld();
  const admission = admissionFor([]);
  const outcomes = await Promise.all(Array.from({ length: 10 }, () => admission.admit(githubInstallation(11, 5000))));
  expect(outcomes.filter((outcome) => outcome.changed)).toHaveLength(1);
  expect(await db.selectFrom('installations').select('id').execute()).toHaveLength(1);
  expect(await auditRows(db)).toHaveLength(1);
  expect(logs.lines().filter((line) => line['msg'] === 'installation.rejected')).toHaveLength(1);
});

test('inside a caller transaction the decision commits with it and rolls back with it', async () => {
  const { admissionFor, db } = await admissionWorld();
  const admission = admissionFor([]);
  await expect(
    db.transaction().execute(async (trx) => {
      await admission.admit(githubInstallation(11, 5000), trx);
      throw new Error('the caller failed after the decision');
    }),
  ).rejects.toThrow('the caller failed after the decision');
  expect(await db.selectFrom('installations').select('id').execute()).toEqual([]);
  expect(await auditRows(db)).toEqual([]);
  await db.transaction().execute((trx) => admission.admit(githubInstallation(11, 5000), trx));
  expect(await db.selectFrom('installations').select('id').execute()).toHaveLength(1);
  expect(await auditRows(db)).toHaveLength(1);
});

test('when the audit row cannot be written the installation row is not written either', async () => {
  const { admissionFor, db } = await admissionWorld();
  await sql`create function refuse_audit() returns trigger language plpgsql as $$ begin raise exception 'audit refused'; end $$`.execute(
    db,
  );
  await sql`create trigger refuse_audit before insert on audit_log for each row execute function refuse_audit()`.execute(
    db,
  );
  await expect(admissionFor([]).admit(githubInstallation(11, 5000))).rejects.toThrow('audit refused');
  expect(await db.selectFrom('installations').select('id').execute()).toEqual([]);
});
