// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createStoredGate, LateBoundGate } from './installation-gate.ts';
import type { InstallationRow } from './installation-state.ts';
import type { InstallationUpsert } from './installation-store.ts';
import { InstallationNotAdmittedError, type NotAdmittedReason } from './ports/github-errors.ts';
import { closedGate, type InstallationGate } from './ports/installation-gate.ts';
import {
  DECIDED_AT,
  installationOf,
  undecidedInstallationOf,
  worldOfTwoTenants,
} from './store-fixture/test-support.ts';

const id = parseGithubId;
const LATER = new Date('2026-06-01T12:00:00Z');

/** Stores the installation `n` (GitHub installation id n * 100) and returns the gate over the store. */
async function gateOver(upsert: InstallationUpsert) {
  const { store } = await worldOfTwoTenants();
  await store.upsertInstallation(upsert);
  return createStoredGate((githubInstallationId) => store.findInstallationByGithubId(githubInstallationId));
}

const rejects = (promise: Promise<void>, reason: NotAdmittedReason) =>
  expect(promise).rejects.toEqual(new InstallationNotAdmittedError(reason));

test('an admitted, active installation is served', async () => {
  const gate = await gateOver(installationOf(1));
  await expect(gate.assertAdmitted(id(100))).resolves.toBeUndefined();
});

test('an installation with no stored row is unknown', async () => {
  const gate = await gateOver(installationOf(1));
  await rejects(gate.assertAdmitted(id(999)), 'unknown');
});

test('a rejected installation is refused as rejected', async () => {
  const gate = await gateOver(
    installationOf(3, { admission: { status: 'rejected', reason: 'account_not_allowed', decidedAt: DECIDED_AT } }),
  );
  await rejects(gate.assertAdmitted(id(300)), 'rejected');
});

test('an installation nobody decided on is refused as rejected: the stored default fails closed', async () => {
  const gate = await gateOver(undecidedInstallationOf(3));
  await rejects(gate.assertAdmitted(id(300)), 'rejected');
});

test('a deleted installation is refused as deleted', async () => {
  const gate = await gateOver(installationOf(3, { deletedAt: LATER }));
  await rejects(gate.assertAdmitted(id(300)), 'deleted');
});

test('a suspended installation is refused as suspended', async () => {
  const gate = await gateOver(installationOf(3, { suspendedAt: LATER }));
  await rejects(gate.assertAdmitted(id(300)), 'suspended');
});

test.each<[string, NotAdmittedReason, Partial<InstallationUpsert>]>([
  [
    'rejected and deleted',
    'rejected',
    { deletedAt: LATER, admission: { status: 'rejected', reason: 'policy_changed', decidedAt: LATER } },
  ],
  [
    'rejected and suspended',
    'rejected',
    { suspendedAt: LATER, admission: { status: 'rejected', reason: 'account_not_allowed', decidedAt: LATER } },
  ],
  ['deleted and suspended', 'deleted', { deletedAt: LATER, suspendedAt: LATER }],
])('an installation that is %s is refused as %s, the outermost reason', async (_label, reason, overrides) => {
  const gate = await gateOver(installationOf(3, overrides));
  await rejects(gate.assertAdmitted(id(300)), reason);
});

test('the gate answers for the installation it is asked about and no other', async () => {
  const { store } = await worldOfTwoTenants();
  await store.upsertInstallation(installationOf(3, { suspendedAt: LATER }));
  const gate = createStoredGate((githubInstallationId) => store.findInstallationByGithubId(githubInstallationId));
  await expect(gate.assertAdmitted(id(100))).resolves.toBeUndefined();
  await expect(gate.assertAdmitted(id(200))).resolves.toBeUndefined();
  await rejects(gate.assertAdmitted(id(300)), 'suspended');
});

test('the gate reads the row on every call: a change of the stored state is seen at once', async () => {
  const { store } = await worldOfTwoTenants();
  const gate = createStoredGate((githubInstallationId) => store.findInstallationByGithubId(githubInstallationId));
  await expect(gate.assertAdmitted(id(100))).resolves.toBeUndefined();
  await store.upsertInstallation(installationOf(1, { deletedAt: LATER }));
  await rejects(gate.assertAdmitted(id(100)), 'deleted');
});

test('a failing read refuses the call with that failure: the gate fails closed', async () => {
  const gate = createStoredGate((): Promise<InstallationRow | null> => Promise.reject(new Error('database down')));
  await expect(gate.assertAdmitted(id(100))).rejects.toThrow('database down');
});

test('a late-bound gate refuses every installation until it is bound, then asks the gate it was bound to', async () => {
  const late = new LateBoundGate();
  await rejects(late.assertAdmitted(id(100)), 'not_wired');
  const asked: number[] = [];
  const open: InstallationGate = {
    assertAdmitted: (githubInstallationId) => {
      asked.push(githubInstallationId);
      return Promise.resolve();
    },
  };
  late.bind(open);
  await expect(late.assertAdmitted(id(100))).resolves.toBeUndefined();
  expect(asked).toEqual([100]);
  late.bind(closedGate);
  await rejects(late.assertAdmitted(id(100)), 'not_wired');
});
