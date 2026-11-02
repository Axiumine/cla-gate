// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import {
  auditActions,
  OWNER,
  remoteInstallation,
  remoteRepositories,
  repositoryRows,
  syncWorld,
} from './sync-fixture/test-support.ts';

// The list of repositories is fetched between the two transactions of a sync, with no connection held. While GitHub is
// slow, another run can close the tenant (E05-S08); the repositories are then not written.

const id = parseGithubId;

test.each([
  ['rejected', { admission_status: 'rejected' as const }],
  ['deleted', { deleted_at: new Date('2026-11-02T10:30:00Z') }],
  ['suspended', { suspended_at: new Date('2026-11-02T10:30:00Z') }],
])(
  'an installation another run turned %s while the list was on its way gets no repository row',
  async (status, change) => {
    const { fake, sync, db } = await syncWorld();
    fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 3));
    fake.beforeNext('listInstallationRepositories', async () => {
      await db.updateTable('installations').set(change).where('github_installation_id', '=', 11).execute();
    });
    const outcome = await sync.syncInstallation(id(11));
    expect(outcome).toEqual({ status, changed: true, repositories: { added: 0, renamed: 0, removed: 0 } });
    expect(await repositoryRows(db)).toEqual([]);
    expect(await auditActions(db)).toEqual(['installation.admitted']);
  },
);

test('a run that finds nothing to change reports the status the lock found, not a success', async () => {
  const { fake, sync, db } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
  await sync.syncInstallation(id(11));
  fake.beforeNext('listInstallationRepositories', async () => {
    await db.updateTable('installations').set({ deleted_at: new Date() }).execute();
  });
  expect(await sync.syncInstallation(id(11))).toEqual({
    status: 'deleted',
    changed: false,
    repositories: { added: 0, renamed: 0, removed: 0 },
  });
});
