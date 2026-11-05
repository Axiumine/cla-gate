// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobSchema } from './jobs.ts';
import { DELIVERY_ID, IDS, JOBS, SHA, sorted } from './test-support.ts';

// The catalogue of jobs (E06-S04): what E07 validates before a handler runs. A job holds ids and nothing else.

const ALL = Object.values(JOBS);

test.each(ALL)('the job $type is valid as the router builds it', (job) => {
  expect(jobSchema.parse(job)).toEqual(job);
});

test.each(ALL)('the job $type is valid without a delivery id, for the callers that have none', (job) => {
  const withoutDelivery = Object.fromEntries(Object.entries(job).filter(([key]) => key !== 'deliveryId'));
  expect(jobSchema.parse(withoutDelivery)).toEqual(withoutDelivery);
});

test.each(ALL)('the job $type refuses a key it does not declare', (job) => {
  expect(jobSchema.safeParse({ ...job, title: 'a copied title' }).success).toBe(false);
  expect(jobSchema.safeParse({ ...job, payload: {} }).success).toBe(false);
});

test.each(ALL)('the job $type refuses a delivery id that is not a UUID', (job) => {
  expect(jobSchema.safeParse({ ...job, deliveryId: 'not-a-uuid' }).success).toBe(false);
  expect(jobSchema.safeParse({ ...job, deliveryId: '' }).success).toBe(false);
  expect(jobSchema.safeParse({ ...job, deliveryId: 7 }).success).toBe(false);
});

const ID_FIELDS = [
  { job: JOBS.evaluatePr, field: 'githubInstallationId' },
  { job: JOBS.evaluatePr, field: 'githubRepoId' },
  { job: JOBS.evaluateHeadSha, field: 'githubInstallationId' },
  { job: JOBS.evaluateHeadSha, field: 'githubRepoId' },
  { job: JOBS.closePr, field: 'githubInstallationId' },
  { job: JOBS.closePr, field: 'githubRepoId' },
  { job: JOBS.recheckComment, field: 'githubInstallationId' },
  { job: JOBS.recheckComment, field: 'githubRepoId' },
  { job: JOBS.recheckComment, field: 'commentId' },
  { job: JOBS.syncInstallation, field: 'githubInstallationId' },
  { job: JOBS.revokeUserSessions, field: 'githubUserId' },
] as const;

const BAD_IDS: readonly unknown[] = ['31001', 1.5, -1, 0, 2 ** 53, Number.NaN, null, undefined, [1], 31_001n];

test.each(ID_FIELDS)('the job $job.type refuses a $field that is not a GitHub id', ({ job, field }) => {
  for (const bad of BAD_IDS) {
    expect(jobSchema.safeParse({ ...job, [field]: bad }).success).toBe(false);
  }
});

test.each(ID_FIELDS)('the job $job.type needs its $field', ({ job, field }) => {
  const rest = Object.fromEntries(Object.entries(job).filter(([key]) => key !== field));
  expect(jobSchema.safeParse(rest).success).toBe(false);
});

test.each([JOBS.evaluatePr, JOBS.closePr, JOBS.recheckComment])(
  'the job $type refuses a pull request number that is not a positive integer',
  (job) => {
    for (const bad of ['7', 0, -1, 1.5, 2 ** 53, null, undefined]) {
      expect(jobSchema.safeParse({ ...job, prNumber: bad }).success).toBe(false);
    }
  },
);

test('evaluate-pr takes any of the triggers E07 and later epics start it with, and no other', () => {
  for (const trigger of ['pull_request', 'recheck', 'check_rerequested', 'signature', 'sweep', 'policy_change']) {
    expect(jobSchema.safeParse({ ...JOBS.evaluatePr, trigger }).success).toBe(true);
  }
  for (const trigger of ['', 'Pull_Request', 'webhook', 7, null, undefined]) {
    expect(jobSchema.safeParse({ ...JOBS.evaluatePr, trigger }).success).toBe(false);
  }
});

test.each(['A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), `${'a'.repeat(39)}g`, `${'a'.repeat(40)}\n`, '', 7, null])(
  'evaluate-head-sha refuses the head sha %s',
  (headSha) => {
    expect(jobSchema.safeParse({ ...JOBS.evaluateHeadSha, headSha }).success).toBe(false);
  },
);

test('evaluate-head-sha takes a 40-digit lower-case sha', () => {
  expect(jobSchema.parse({ ...JOBS.evaluateHeadSha, headSha: SHA }).type).toBe('evaluate-head-sha');
});

test.each(['', 'evaluate', 'EVALUATE-PR', 'sweep-repository', 'constructor', '__proto__', 7, null, undefined])(
  'a job of type %s is not in the catalogue',
  (type) => {
    expect(jobSchema.safeParse({ type, githubInstallationId: IDS.installation, deliveryId: DELIVERY_ID }).success).toBe(
      false,
    );
  },
);

test('a job that is not an object is refused', () => {
  for (const bad of [null, undefined, 'evaluate-pr', 7, [], [JOBS.evaluatePr]]) {
    expect(jobSchema.safeParse(bad).success).toBe(false);
  }
});

test('the catalogue has the seven jobs a webhook can start, and the type names the queue', () => {
  expect(sorted(ALL.map((job) => job.type))).toEqual([
    'close-pr',
    'evaluate-head-sha',
    'evaluate-merge-group',
    'evaluate-pr',
    'recheck-comment',
    'revoke-user-sessions',
    'sync-installation',
  ]);
});
