// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import { createAdmissionPolicy } from '../domain/admission.ts';
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

/** The policy in force: the accounts of tenants 1 to 3 (n * 1000) and the App owner are served. */
const policies = (...accounts: number[]) => ({
  current: () =>
    Promise.resolve(
      createAdmissionPolicy(
        accounts.map((account) => id(account)),
        id(9001),
      ),
    ),
});
const SERVING_TENANTS = policies(1000, 2000, 3000);

/** Stores the installation `n` (GitHub installation id n * 100) and returns the gate over the store. */
async function gateOver(upsert: InstallationUpsert) {
  const { store } = await worldOfTwoTenants();
  await store.upsertInstallation(upsert);
  return createStoredGate(
    (githubInstallationId) => store.findInstallationByGithubId(githubInstallationId),
    SERVING_TENANTS,
  );
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
  const gate = createStoredGate(
    (githubInstallationId) => store.findInstallationByGithubId(githubInstallationId),
    SERVING_TENANTS,
  );
  await expect(gate.assertAdmitted(id(100))).resolves.toBeUndefined();
  await expect(gate.assertAdmitted(id(200))).resolves.toBeUndefined();
  await rejects(gate.assertAdmitted(id(300)), 'suspended');
});

test('the gate reads the row on every call: a change of the stored state is seen at once', async () => {
  const { store } = await worldOfTwoTenants();
  const gate = createStoredGate(
    (githubInstallationId) => store.findInstallationByGithubId(githubInstallationId),
    SERVING_TENANTS,
  );
  await expect(gate.assertAdmitted(id(100))).resolves.toBeUndefined();
  await store.upsertInstallation(installationOf(1, { deletedAt: LATER }));
  await rejects(gate.assertAdmitted(id(100)), 'deleted');
});

test('a failing read refuses the call with that failure: the gate fails closed', async () => {
  const gate = createStoredGate(
    (): Promise<InstallationRow | null> => Promise.reject(new Error('database down')),
    SERVING_TENANTS,
  );
  await expect(gate.assertAdmitted(id(100))).rejects.toThrow('database down');
});

// The policy in force, not only the stored decision (E05-S07): an account the operator removed from
// GITHUB_ALLOWED_ACCOUNT_IDS is refused at the next start although no reconciliation has re-decided its row yet.

test('an account the policy no longer serves is refused as rejected although its stored row still says admitted', async () => {
  const { store } = await worldOfTwoTenants();
  const find = (githubInstallationId: GithubId) => store.findInstallationByGithubId(githubInstallationId);
  await expect(createStoredGate(find, policies(1000, 2000)).assertAdmitted(id(100))).resolves.toBeUndefined();
  const tightened = createStoredGate(find, policies(2000));
  await rejects(tightened.assertAdmitted(id(100)), 'rejected');
  await expect(tightened.assertAdmitted(id(200))).resolves.toBeUndefined();
  expect((await store.findInstallationByGithubId(id(100)))?.admission_status).toBe('admitted');
});

test('the policy is read on every call: tightening it is seen at once, with no sync in between', async () => {
  const { store } = await worldOfTwoTenants();
  let current = policies(1000, 2000);
  const gate = createStoredGate((githubInstallationId) => store.findInstallationByGithubId(githubInstallationId), {
    current: () => current.current(),
  });
  await expect(gate.assertAdmitted(id(100))).resolves.toBeUndefined();
  current = policies(2000);
  await rejects(gate.assertAdmitted(id(100)), 'rejected');
});

test('an installation the policy no longer serves and that was also uninstalled is rejected: the outermost reason', async () => {
  const { store } = await worldOfTwoTenants();
  await store.upsertInstallation(installationOf(3, { deletedAt: LATER }));
  const gate = createStoredGate(
    (githubInstallationId) => store.findInstallationByGithubId(githubInstallationId),
    policies(1000),
  );
  await rejects(gate.assertAdmitted(id(300)), 'rejected');
});

test('a policy that cannot be built yet (the App owner is unknown) refuses with that failure', async () => {
  const { store } = await worldOfTwoTenants();
  const gate = createStoredGate((githubInstallationId) => store.findInstallationByGithubId(githubInstallationId), {
    current: () => Promise.reject(new Error('owner unknown')),
  });
  await expect(gate.assertAdmitted(id(100))).rejects.toThrow('owner unknown');
});

test('a stored refusal is final without asking the policy', async () => {
  const { store } = await worldOfTwoTenants();
  await store.upsertInstallation(
    installationOf(3, { admission: { status: 'rejected', reason: 'account_not_allowed', decidedAt: LATER } }),
  );
  const asked: string[] = [];
  const gate = createStoredGate((githubInstallationId) => store.findInstallationByGithubId(githubInstallationId), {
    current: () => {
      asked.push('policy');
      return Promise.reject(new Error('must not be asked'));
    },
  });
  await rejects(gate.assertAdmitted(id(300)), 'rejected');
  expect(asked).toEqual([]);
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
