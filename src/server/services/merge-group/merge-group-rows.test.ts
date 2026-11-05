// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { migratedTestDatabase, seedTenant } from '../../adapters/db/test-support.ts';
import { detailsOfFailure, detailsOfMembers } from '../../domain/merge-group.ts';
import {
  failGroupEvaluation,
  findGroupRow,
  finishGroupEvaluation,
  type GroupKey,
  markGroupDestroyed,
  recordGroupCheckRun,
  startGroupEvaluation,
} from './merge-group-rows.ts';

// The rows of `merge_group_evaluations` (E22-S01): one per head SHA of a repository, written by the job and by the dead-letter
// handler, never again once the group is destroyed. The cross-tenant checks of every function are in the tenant registry.

const HEAD = '9'.repeat(40);
const BASE = '8'.repeat(40);

async function world() {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  const key: GroupKey = { installationId: tenant.installationId, repositoryId: tenant.repositoryId, headSha: HEAD };
  return { db, tenant, key };
}

const rowsOf = (db: Awaited<ReturnType<typeof world>>['db']) =>
  db.selectFrom('merge_group_evaluations').selectAll().orderBy('id').execute();

test('a group that was never seen has no row, and starting it creates one in progress with both SHAs', async () => {
  const { db, key } = await world();
  expect(await findGroupRow(db, key)).toBeNull();
  const started = await startGroupEvaluation(db, key, BASE);
  expect(started?.id).toBeGreaterThan(0);
  expect(started).toEqual({ id: started?.id, checkRunId: null });
  const [row, ...others] = await rowsOf(db);
  expect(others).toEqual([]);
  expect(row).toMatchObject({
    installation_id: key.installationId,
    repository_id: key.repositoryId,
    head_sha: HEAD,
    base_sha: BASE,
    result: 'in_progress',
    details: {},
    check_run_id: null,
    destroyed_at: null,
  });
  expect(await findGroupRow(db, key)).toEqual({ ...started, destroyedAt: null });
});

test('starting a group twice leaves one row with the same id: two deliveries for one SHA are one evaluation', async () => {
  const { db, key } = await world();
  const first = await startGroupEvaluation(db, key, BASE);
  const second = await startGroupEvaluation(db, key, BASE);
  expect(second?.id).toBe(first?.id);
  expect(await rowsOf(db)).toHaveLength(1);
});

test('starting a group again puts it back in progress and keeps the Check Run an earlier run recorded', async () => {
  const { db, tenant, key } = await world();
  const first = await startGroupEvaluation(db, key, BASE);
  await finishGroupEvaluation(db, tenant.installationId, first?.id ?? 0, detailsOfMembers([]));
  await recordGroupCheckRun(db, tenant.installationId, first?.id ?? 0, 4242);
  const again = await startGroupEvaluation(db, key, '7'.repeat(40));
  expect(again).toEqual({ id: first?.id, checkRunId: 4242 });
  expect(await rowsOf(db)).toMatchObject([
    { result: 'in_progress', details: {}, base_sha: '7'.repeat(40), check_run_id: 4242 },
  ]);
});

test('the verdict and its details are stored on the row, and the row says so', async () => {
  const { db, tenant, key } = await world();
  const started = await startGroupEvaluation(db, key, BASE);
  const details = detailsOfMembers([{ prNumber: 5, outcome: 'success', failureCodes: [] }]);
  expect(await finishGroupEvaluation(db, tenant.installationId, started?.id ?? 0, details)).toBe(true);
  expect(await rowsOf(db)).toMatchObject([{ result: 'success', details }]);
});

test('a group GitHub took down is never started again, finished or failed, and keeps what it holds', async () => {
  const { db, tenant, key } = await world();
  const started = await startGroupEvaluation(db, key, BASE);
  await markGroupDestroyed(db, await githubIds(db, key));
  const before = await rowsOf(db);
  expect(before[0]?.destroyed_at).toBeInstanceOf(Date);
  expect(await startGroupEvaluation(db, key, BASE)).toBeNull();
  expect(
    await finishGroupEvaluation(db, tenant.installationId, started?.id ?? 0, detailsOfFailure('evaluation_failed')),
  ).toBe(false);
  expect(await failGroupEvaluation(db, key, BASE)).toBeNull();
  expect(await rowsOf(db)).toEqual(before);
});

test('the Check Run of a group that was destroyed meanwhile is still recorded: the run exists', async () => {
  const { db, tenant, key } = await world();
  const started = await startGroupEvaluation(db, key, BASE);
  await markGroupDestroyed(db, await githubIds(db, key));
  await recordGroupCheckRun(db, tenant.installationId, started?.id ?? 0, 77);
  expect(await rowsOf(db)).toMatchObject([{ check_run_id: 77 }]);
});

test('destroying a group that was never evaluated leaves a tombstone, and destroying one twice keeps the first instant', async () => {
  const { db, key } = await world();
  await markGroupDestroyed(db, await githubIds(db, key));
  expect(await rowsOf(db)).toMatchObject([
    { head_sha: HEAD, base_sha: BASE, result: 'in_progress', details: {}, check_run_id: null },
  ]);
  const [first] = await rowsOf(db);
  expect(first?.destroyed_at).toBeInstanceOf(Date);
  await markGroupDestroyed(db, await githubIds(db, key));
  const [second, ...others] = await rowsOf(db);
  expect(others).toEqual([]);
  expect(second?.destroyed_at).toEqual(first?.destroyed_at);
});

test('a group destroyed before its job ran is never started, failed or reported: the tombstone is what the job meets', async () => {
  const { db, key } = await world();
  await markGroupDestroyed(db, await githubIds(db, key));
  const before = await rowsOf(db);
  expect(await startGroupEvaluation(db, key, BASE)).toBeNull();
  expect(await failGroupEvaluation(db, key, BASE)).toBeNull();
  expect(await rowsOf(db)).toEqual(before);
  expect((await findGroupRow(db, key))?.destroyedAt).toBeInstanceOf(Date);
});

test('a tombstone is made for the repository the delivery names and no other: an unknown repository or installation leaves no row', async () => {
  const { db, key } = await world();
  const ids = await githubIds(db, key);
  await markGroupDestroyed(db, { ...ids, githubRepoId: ids.githubRepoId + 1 });
  await markGroupDestroyed(db, { ...ids, githubInstallationId: ids.githubInstallationId + 1 });
  expect(await rowsOf(db)).toEqual([]);
});

test('failing a group that has no row creates it as a failure with the code of a dead job', async () => {
  const { db, key } = await world();
  const failed = await failGroupEvaluation(db, key, BASE);
  expect(failed?.id).toBeGreaterThan(0);
  expect(failed).toEqual({ id: failed?.id, checkRunId: null });
  expect(await rowsOf(db)).toMatchObject([
    { result: 'failure', details: detailsOfFailure('evaluation_failed'), base_sha: BASE },
  ]);
});

test('failing a group replaces a verdict a retry stored before the job died, keeps its Check Run, and a second call changes nothing more', async () => {
  const { db, tenant, key } = await world();
  const started = await startGroupEvaluation(db, key, BASE);
  await finishGroupEvaluation(
    db,
    tenant.installationId,
    started?.id ?? 0,
    detailsOfMembers([{ prNumber: 5, outcome: 'success', failureCodes: [] }]),
  );
  await recordGroupCheckRun(db, tenant.installationId, started?.id ?? 0, 4242);
  expect(await failGroupEvaluation(db, key, BASE)).toEqual({ id: started?.id, checkRunId: 4242 });
  expect(await failGroupEvaluation(db, key, BASE)).toEqual({ id: started?.id, checkRunId: 4242 });
  expect(await rowsOf(db)).toMatchObject([
    { result: 'failure', details: detailsOfFailure('evaluation_failed'), check_run_id: 4242 },
  ]);
});

test('a head SHA is a row per repository: the same SHA in two repositories is two rows', async () => {
  const { db, tenant, key } = await world();
  const second = await db
    .insertInto('repositories')
    .values({
      installation_id: tenant.installationId,
      github_repo_id: 9001,
      full_name: 'org-1/second',
      cla_document_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await startGroupEvaluation(db, key, BASE);
  await startGroupEvaluation(db, { ...key, repositoryId: second.id }, BASE);
  expect((await rowsOf(db)).map((row) => row.repository_id)).toEqual([key.repositoryId, second.id]);
});

/** The GitHub ids of the installation and the repository of `key`, which is how a delivery names them. */
async function githubIds(db: Awaited<ReturnType<typeof world>>['db'], key: GroupKey) {
  const installation = await db
    .selectFrom('installations')
    .select('github_installation_id')
    .where('id', '=', key.installationId)
    .executeTakeFirstOrThrow();
  const repository = await db
    .selectFrom('repositories')
    .select('github_repo_id')
    .where('id', '=', key.repositoryId)
    .executeTakeFirstOrThrow();
  return {
    githubInstallationId: installation.github_installation_id,
    githubRepoId: repository.github_repo_id,
    headSha: key.headSha,
    baseSha: BASE,
  };
}
