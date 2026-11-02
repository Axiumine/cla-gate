// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { INSTALLATION } from '../evaluate-pr/test-support.ts';
import { type DeadWorld, deadWorld, logged } from './test-support.ts';

// A dead `sync-installation` (E07-S05): one audit row under the installation and a line at error. The reconciliation of
// E05-S08 retries the sync later, so nothing else is done and GitHub is not asked anything.

const JOB = { type: 'sync-installation', githubInstallationId: INSTALLATION } as const;

const auditRows = (world: DeadWorld) =>
  world.raw
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'action', 'subject_type', 'subject_id', 'metadata'])
    .orderBy('id')
    .execute();

test('a dead sync appends installation.sync_failed under the installation, with the GitHub installation id as the subject and no actor', async () => {
  const world = await deadWorld();
  expect(await world.runDead(JOB)).toEqual({ outcome: 'audited' });
  expect(await auditRows(world)).toEqual([
    {
      installation_id: world.tenant.installationId,
      actor_github_id: null,
      action: 'installation.sync_failed',
      subject_type: 'installation',
      subject_id: INSTALLATION,
      metadata: { reason_code: 'retries_exhausted' },
    },
  ]);
  expect(world.calls()).toEqual([]);
});

test('the dead job is logged at error with the installation id and the outcome, and nothing personal', async () => {
  const world = await deadWorld();
  await world.runDead({ ...JOB, deliveryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' });
  expect(logged(world, 'job.dead_lettered')).toMatchObject([
    { level: 50, type: 'sync-installation', githubInstallationId: INSTALLATION, outcome: 'audited' },
  ]);
  expect(world.logs.text()).not.toContain('org-1');
});

test('an installation this instance never stored has no tenant for a row: the job is logged at error and ends', async () => {
  const world = await deadWorld();
  expect(await world.runDead({ ...JOB, githubInstallationId: parseGithubId(999_999) })).toEqual({ outcome: 'logged' });
  expect(await auditRows(world)).toEqual([]);
  expect(logged(world, 'job.dead_lettered')).toMatchObject([{ level: 50, outcome: 'logged' }]);
});

test('the row goes to the installation the job names and to no other', async () => {
  const world = await deadWorld();
  const other = await seedTenant(world.raw, 2);
  await world.runDead(JOB);
  const rows = await auditRows(world);
  expect(rows.map((row) => row.installation_id)).toEqual([world.tenant.installationId]);
  expect(rows.map((row) => row.installation_id)).not.toContain(other.installationId);
});

test('a database that refuses the row fails the job, so the queue retries it', async () => {
  const world = await deadWorld();
  await sql`drop table audit_log cascade`.execute(world.raw);
  await expect(world.runDead(JOB)).rejects.toThrow('audit_log');
});
