// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluationEligibility, type IneligibleReason, type InstallationState } from './eligibility.ts';
import { type TenantState, tenantState } from './tenant-state.ts';

// The state of a tenant for access (E11-S07). The domain never reads a timestamp, so any object stands for "set".
const WHEN = { at: 'some time' };

type Flag = 'rejected' | 'deleted' | 'suspended';

function installationWith(raised: readonly Flag[]): InstallationState {
  return {
    admissionStatus: raised.includes('rejected') ? 'rejected' : 'admitted',
    deletedAt: raised.includes('deleted') ? WHEN : null,
    suspendedAt: raised.includes('suspended') ? WHEN : null,
  };
}

// All eight combinations of the three flags, written out: the first that applies wins, in the order rejected, deleted,
// suspended.
const TABLE: readonly (readonly [string, readonly Flag[], TenantState])[] = [
  ['nothing is set', [], 'active'],
  ['suspended', ['suspended'], 'suspended'],
  ['deleted', ['deleted'], 'deleted'],
  ['deleted and suspended', ['deleted', 'suspended'], 'deleted'],
  ['rejected', ['rejected'], 'rejected'],
  ['rejected and suspended', ['rejected', 'suspended'], 'rejected'],
  ['rejected and deleted', ['rejected', 'deleted'], 'rejected'],
  ['rejected, deleted and suspended', ['rejected', 'deleted', 'suspended'], 'rejected'],
];

test('the table lists all eight combinations of the three flags, each once', () => {
  expect(TABLE).toHaveLength(8);
  const keys = TABLE.map(([, flags]) => [...flags].toSorted((a, b) => a.localeCompare(b)).join('+'));
  expect(new Set(keys).size).toBe(8);
});

test.each(TABLE)('%s: the state is %s', (_name, raised, state) => {
  expect(tenantState(installationWith(raised))).toBe(state);
});

/** The state each reason of `evaluationEligibility` stands for: the repository reasons say nothing of the tenant, which is active then. */
const STATE_OF_REASON: Readonly<Record<IneligibleReason, TenantState>> = {
  installation_rejected: 'rejected',
  installation_deleted: 'deleted',
  installation_suspended: 'suspended',
  repository_removed: 'active',
  repository_disabled: 'active',
};

test.each(TABLE)(
  '%s: agrees with the installation reasons of the evaluation eligibility (E05-S06)',
  (_name, raised) => {
    const installation = installationWith(raised);
    // The repository is eligible, so the only reasons left are those of the installation.
    const eligibility = evaluationEligibility(installation, { removedAt: null, enabled: true });
    const expected = eligibility.eligible ? 'active' : STATE_OF_REASON[eligibility.reason];
    expect(tenantState(installation)).toBe(expected);
  },
);
