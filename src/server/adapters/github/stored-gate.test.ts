// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { createAdmissionPolicy } from '../../domain/admission.ts';
import { id, installation, repository } from '../../services/github-contract/test-support.ts';
import { createStoredGate } from '../../services/installation-gate.ts';
import { createInstallationStore, type InstallationUpsert } from '../../services/installation-store.ts';
import { InstallationNotAdmittedError, type NotAdmittedReason } from '../../services/ports/github-errors.ts';
import { DECIDED_AT, installationOf } from '../../services/store-fixture/test-support.ts';
import { FakeGitHub } from '../../services/test-support.ts';
import { migratedTestDatabase } from '../db/test-support.ts';
import { gatedHttpWorld } from './http-world/test-support.ts';

// The gate of E05-S07 in front of every installation-level method of the client port: a rejected, deleted, suspended or
// unknown installation is refused before any request is made, over the Octokit adapter (MSW sees nothing after the
// App's own start-up check) and over FakeGitHub (it records no call).

const signer = testGitHubKey();
// The account of installationOf(1) (n * 1000) is served by the policy in force.
const POLICIES = { current: () => Promise.resolve(createAdmissionPolicy([parseGithubId(1000)], parseGithubId(9001))) };
const LATER = new Date('2026-06-01T12:00:00Z');
const REJECTED = { status: 'rejected', reason: 'account_not_allowed', decidedAt: DECIDED_AT } as const;

// Installation 11 is stored in the state the row names; the GitHub side always has it, active and with a repository.
const STATES: readonly [NotAdmittedReason, Partial<InstallationUpsert> | undefined][] = [
  ['rejected', { admission: REJECTED }],
  ['deleted', { deletedAt: LATER }],
  ['suspended', { suspendedAt: LATER }],
  ['unknown', undefined],
];

async function gateFor(state: Partial<InstallationUpsert> | undefined) {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  if (state !== undefined) {
    await store.upsertInstallation({ ...installationOf(1, { githubInstallationId: parseGithubId(11) }), ...state });
  }
  return createStoredGate((githubInstallationId) => store.findInstallationByGithubId(githubInstallationId), POLICIES);
}

test.each(STATES)(
  'an installation that is %s: every installation-level method over the adapter throws before any request',
  async (reason, state) => {
    const http = await gatedHttpWorld(signer, await gateFor(state));
    http.addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
    const refused = new InstallationNotAdmittedError(reason);
    await expect(http.client.listInstallationRepositories(id(11))).rejects.toEqual(refused);
    await expect(http.client.getRepositoryById(id(11), id(101))).rejects.toEqual(refused);
    await expect(http.client.getOrgMembership(id(11), 'acme', 'alice')).rejects.toEqual(refused);
    expect(http.requests).toEqual([]);
  },
);

test.each(STATES)(
  'an installation that is %s: every installation-level method over FakeGitHub throws and records no call',
  async (reason, state) => {
    const fake = new FakeGitHub({ gate: await gateFor(state) });
    fake.addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
    const refused = new InstallationNotAdmittedError(reason);
    await expect(fake.listInstallationRepositories(id(11))).rejects.toEqual(refused);
    await expect(fake.getRepositoryById(id(11), id(101))).rejects.toEqual(refused);
    await expect(fake.getOrgMembership(id(11), 'acme', 'alice')).rejects.toEqual(refused);
    expect(fake.calls).toEqual([]);
  },
);

test('an admitted installation is served through the same gate: a token is requested and the repositories come back', async () => {
  const http = await gatedHttpWorld(signer, await gateFor({}));
  http.addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
  expect(await http.client.listInstallationRepositories(id(11))).toEqual([repository(101, 'acme/api')]);
  expect(http.requests).toEqual([
    'POST /app/installations/11/access_tokens',
    'GET /installation/repositories?per_page=100',
  ]);
});

test('the App-level methods are not behind an installation: a rejected installation can still be looked up and listed', async () => {
  const http = await gatedHttpWorld(signer, await gateFor({ admission: REJECTED }));
  http.addInstallation(installation(11, 'acme'));
  expect((await http.client.getInstallation(id(11)))?.id).toBe(11);
  expect(await http.client.listInstallations()).toHaveLength(1);
  expect(http.requests).toEqual(['GET /app/installations/11', 'GET /app/installations?per_page=100']);
});
