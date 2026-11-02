// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { InstallationState } from './eligibility.ts';
import { type Job, jobSchema } from './jobs.ts';
import { DELIVERY_ID, IDS, JOBS, sorted } from './test-support.ts';
import {
  isTenantJob,
  judgeInstallation,
  judgeRepository,
  type TenantJob,
  type TenantVerdict,
} from './webhook-tenant.ts';

// The tenant and admission filter as a pure decision (E06-S05): two facts in, a verdict out.

// The domain never reads a timestamp, so any object stands for "set".
const WHEN = { at: 'some time' };

const SERVED: InstallationState = { admissionStatus: 'admitted', deletedAt: null, suspendedAt: null };

/** A job as the router builds it, with the brand of its ids. */
function jobOf(job: unknown): Job {
  return jobSchema.parse(job);
}

function tenantJobOf(job: unknown): TenantJob {
  const parsed = jobOf(job);
  if (!isTenantJob(parsed)) {
    throw new Error(`${parsed.type} is not a job of a tenant's repository`);
  }
  return parsed;
}

/** The sync a delivery was replaced by. */
function syncOf(verdict: TenantVerdict) {
  if (verdict.kind !== 'redirected') {
    throw new Error(`the verdict is ${verdict.kind}, not a redirection`);
  }
  return verdict.job;
}

const SYNC = {
  type: 'sync-installation',
  githubInstallationId: IDS.installation,
  deliveryId: DELIVERY_ID,
} as const;

const TENANT_JOBS = [JOBS.evaluatePr, JOBS.closePr, JOBS.evaluateHeadSha, JOBS.recheckComment] as const;

test.each(TENANT_JOBS)('the filter applies to the job $type', (job) => {
  expect(isTenantJob(jobOf(job))).toBe(true);
});

test.each([JOBS.syncInstallation, JOBS.revokeUserSessions])('the filter does not apply to the job $type', (job) => {
  expect(isTenantJob(jobOf(job))).toBe(false);
});

test.each(TENANT_JOBS)(
  'an installation that is not stored turns the job $type into a sync of that installation',
  (job) => {
    expect(judgeInstallation(tenantJobOf(job), null)).toEqual({
      kind: 'redirected',
      reason: 'installation_unknown',
      job: SYNC,
    });
  },
);

test('the sync that replaces a delivery is a valid job that names the installation and the delivery and nothing else', () => {
  const job = syncOf(judgeInstallation(tenantJobOf(JOBS.recheckComment), null));
  expect(jobSchema.parse(job)).toEqual(SYNC);
  expect(sorted(Object.keys(job))).toEqual(['deliveryId', 'githubInstallationId', 'type']);
});

test('a job without a delivery id is replaced by a sync without one', () => {
  const withoutDelivery = Object.fromEntries(Object.entries(JOBS.evaluatePr).filter(([key]) => key !== 'deliveryId'));
  const job = syncOf(judgeInstallation(tenantJobOf(withoutDelivery), null));
  expect(job.deliveryId).toBeUndefined();
});

const INSTALLATIONS: readonly [title: string, state: InstallationState, verdict: object][] = [
  ['admitted and active', SERVED, { kind: 'served' }],
  [
    'rejected by the policy',
    { ...SERVED, admissionStatus: 'rejected' },
    { kind: 'ignored', reason: 'installation_not_admitted' },
  ],
  ['uninstalled', { ...SERVED, deletedAt: WHEN }, { kind: 'ignored', reason: 'installation_deleted' }],
  ['suspended', { ...SERVED, suspendedAt: WHEN }, { kind: 'ignored', reason: 'installation_suspended' }],
  [
    'rejected and uninstalled, which is reported as rejected',
    { admissionStatus: 'rejected', deletedAt: WHEN, suspendedAt: null },
    { kind: 'ignored', reason: 'installation_not_admitted' },
  ],
  [
    'rejected and suspended, which is reported as rejected',
    { admissionStatus: 'rejected', deletedAt: null, suspendedAt: WHEN },
    { kind: 'ignored', reason: 'installation_not_admitted' },
  ],
  [
    'uninstalled and suspended, which is reported as uninstalled',
    { admissionStatus: 'admitted', deletedAt: WHEN, suspendedAt: WHEN },
    { kind: 'ignored', reason: 'installation_deleted' },
  ],
];

test.each(INSTALLATIONS)('an installation that is %s', (_title, state, verdict) => {
  expect(judgeInstallation(tenantJobOf(JOBS.evaluatePr), state)).toEqual(verdict);
});

test.each(TENANT_JOBS)('the verdict on an installation is the same for the job $type', (job) => {
  const rejected: InstallationState = { ...SERVED, admissionStatus: 'rejected' };
  expect(judgeInstallation(tenantJobOf(job), rejected)).toEqual({
    kind: 'ignored',
    reason: 'installation_not_admitted',
  });
  expect(judgeInstallation(tenantJobOf(job), SERVED)).toEqual({ kind: 'served' });
});

test.each(TENANT_JOBS)(
  'a repository stored under another installation turns the job $type into a sync of the payload installation',
  (job) => {
    expect(judgeRepository(tenantJobOf(job), { heldByAnotherInstallation: true })).toEqual({
      kind: 'redirected',
      reason: 'repository_installation_mismatch',
      job: SYNC,
    });
  },
);

test('a repository that is not stored under another installation is served, stored here or not at all', () => {
  expect(judgeRepository(tenantJobOf(JOBS.evaluatePr), { heldByAnotherInstallation: false })).toEqual({
    kind: 'served',
  });
});

test('no verdict carries the repository, a pull request number or a comment', () => {
  const verdicts = [
    judgeInstallation(tenantJobOf(JOBS.recheckComment), null),
    judgeRepository(tenantJobOf(JOBS.recheckComment), { heldByAnotherInstallation: true }),
  ];
  for (const verdict of verdicts) {
    const text = JSON.stringify(verdict);
    expect(text).not.toContain(String(IDS.repository));
    expect(text).not.toContain(String(IDS.comment));
    expect(text).not.toContain('prNumber');
  }
});
