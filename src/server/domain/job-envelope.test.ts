// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { JOB_TYPES, jobEnvelopeSchema, logFieldsOf } from './job-envelope.ts';
import { jobSchema } from './jobs.ts';
import { CANARY, DELIVERY_ID, IDS, JOBS, SHA } from './test-support.ts';

// The envelope of every job on the queue (E07-S03): the catalogue of E06-S04 plus the two jobs of the scheduler.

const SWEEP = { type: 'sweep' } as const;
const SWEEP_INSTALLATION = { type: 'sweep-installation', githubInstallationId: IDS.installation } as const;
const ALL = [...Object.values(JOBS), SWEEP, SWEEP_INSTALLATION];

test('the envelope has the eight jobs a worker can receive, in the order of the schema', () => {
  expect(JOB_TYPES).toEqual([
    'evaluate-pr',
    'evaluate-head-sha',
    'close-pr',
    'recheck-comment',
    'sync-installation',
    'revoke-user-sessions',
    'sweep',
    'sweep-installation',
  ]);
});

test('the envelope is the catalogue of E06-S04 unchanged, plus the two jobs of the scheduler', () => {
  expect(JOB_TYPES.slice(0, jobSchema.options.length)).toEqual(
    jobSchema.options.map((option) => option.shape.type.value),
  );
  expect(JOB_TYPES).toHaveLength(jobSchema.options.length + 2);
});

test.each(ALL)('the job $type is valid as its producer builds it', (job) => {
  expect(jobEnvelopeSchema.parse(job)).toEqual(job);
});

test.each(ALL)('the job $type refuses a field it does not declare', (job) => {
  expect(jobEnvelopeSchema.safeParse({ ...job, title: CANARY }).success).toBe(false);
});

test.each([SWEEP, SWEEP_INSTALLATION])('the scheduler job $type has no delivery: a delivery id is refused', (job) => {
  expect(jobEnvelopeSchema.safeParse({ ...job, deliveryId: DELIVERY_ID }).success).toBe(false);
});

test.each(['31001', 0, -1, 1.5, 2 ** 53, null, undefined, [1]])(
  'sweep-installation refuses the installation id %s',
  (bad) => {
    expect(jobEnvelopeSchema.safeParse({ ...SWEEP_INSTALLATION, githubInstallationId: bad }).success).toBe(false);
  },
);

test('sweep-installation needs its installation id', () => {
  expect(jobEnvelopeSchema.safeParse({ type: 'sweep-installation' }).success).toBe(false);
});

test.each([
  '',
  'sweep-repository',
  'finalise-check',
  'job-dead-letter',
  'constructor',
  '__proto__',
  7,
  null,
  undefined,
])('a job of type %s is not in the envelope', (type) => {
  expect(jobEnvelopeSchema.safeParse({ type, githubInstallationId: IDS.installation }).success).toBe(false);
});

test.each([null, undefined, 'evaluate-pr', 7, [], [JOBS.evaluatePr], {}])(
  'data that is not a job (%j) is refused',
  (bad) => {
    expect(jobEnvelopeSchema.safeParse(bad).success).toBe(false);
  },
);

const parsed = (job: unknown) => jobEnvelopeSchema.parse(job);

test('the log fields of a job are its numeric ids, its delivery and its trigger, nothing else', () => {
  expect(logFieldsOf(parsed(JOBS.evaluatePr))).toEqual({
    deliveryId: DELIVERY_ID,
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    prNumber: IDS.pullRequestNumber,
    trigger: 'pull_request',
  });
  expect(logFieldsOf(parsed(JOBS.recheckComment))).toMatchObject({ commentId: IDS.comment });
  expect(logFieldsOf(parsed(JOBS.revokeUserSessions))).toEqual({ deliveryId: DELIVERY_ID, githubUserId: IDS.sender });
});

test('the log fields leave out the head sha and anything that is not a field of the envelope', () => {
  const job = Object.assign(parsed(JOBS.evaluateHeadSha), { title: CANARY, comment: { body: CANARY } });
  const fields = logFieldsOf(job);
  expect(fields).toEqual({
    deliveryId: DELIVERY_ID,
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
  });
  expect(JSON.stringify(fields)).not.toContain(SHA);
  expect(JSON.stringify(fields)).not.toContain(CANARY);
});

test('a job that carries no id has no log fields', () => {
  expect(logFieldsOf(parsed(SWEEP))).toEqual({});
});

test('a field of the wrong kind never reaches the log fields', () => {
  expect(logFieldsOf(Object.assign(parsed(SWEEP), { prNumber: { nested: CANARY } }))).toEqual({});
});
