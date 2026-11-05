// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { JOB_TYPES, jobEnvelopeSchema, logFieldsOf } from './job-envelope.ts';
import { jobSchema } from './jobs.ts';
import { SWEEP_REPOSITORY_REASONS } from './repository-jobs.ts';
import { CANARY, DELIVERY_ID, IDS, JOBS, SHA } from './test-support.ts';

// The envelope of every job on the queue (E07-S03): the catalogue of E06-S04 plus the two jobs of the scheduler.

const SWEEP = { type: 'sweep' } as const;
const RETENTION_SWEEP = { type: 'retention-sweep' } as const;
const SWEEP_INSTALLATION = { type: 'sweep-installation', githubInstallationId: IDS.installation } as const;
const REPOSITORY_IDS = { githubInstallationId: IDS.installation, githubRepoId: IDS.repository } as const;
const SWEEP_REPOSITORY = { type: 'sweep-repository', ...REPOSITORY_IDS, reason: 'allowlist_changed' } as const;
const FINALISE_REPOSITORY = { type: 'finalise-repository', ...REPOSITORY_IDS } as const;
const FINALISE_CHECK = { type: 'finalise-check', ...REPOSITORY_IDS, prNumber: IDS.pullRequestNumber } as const;
const REPOSITORY_JOBS = [SWEEP_REPOSITORY, FINALISE_REPOSITORY, FINALISE_CHECK];
const ALL = [...Object.values(JOBS), SWEEP, SWEEP_INSTALLATION, ...REPOSITORY_JOBS, RETENTION_SWEEP];

test('the envelope has the thirteen jobs a worker can receive, in the order of the schema', () => {
  expect(JOB_TYPES).toEqual([
    'evaluate-pr',
    'evaluate-head-sha',
    'close-pr',
    'recheck-comment',
    'evaluate-merge-group',
    'sync-installation',
    'revoke-user-sessions',
    'sweep',
    'sweep-installation',
    'sweep-repository',
    'finalise-repository',
    'finalise-check',
    'retention-sweep',
  ]);
});

test('the envelope is the catalogue of E06-S04 unchanged, plus the two jobs of the scheduler, the three of a change of policy and the daily retention sweep', () => {
  expect(JOB_TYPES.slice(0, jobSchema.options.length)).toEqual(
    jobSchema.options.map((option) => option.shape.type.value),
  );
  expect(JOB_TYPES).toHaveLength(jobSchema.options.length + 6);
});

test.each(ALL)('the job $type is valid as its producer builds it', (job) => {
  expect(jobEnvelopeSchema.parse(job)).toEqual(job);
});

test.each(ALL)('the job $type refuses a field it does not declare', (job) => {
  expect(jobEnvelopeSchema.safeParse({ ...job, title: CANARY }).success).toBe(false);
});

test.each([SWEEP, SWEEP_INSTALLATION, ...REPOSITORY_JOBS, RETENTION_SWEEP])(
  'the job $type has no delivery: a delivery id is refused',
  (job) => {
    expect(jobEnvelopeSchema.safeParse({ ...job, deliveryId: DELIVERY_ID }).success).toBe(false);
  },
);

test.each(['31001', 0, -1, 1.5, 2 ** 53, null, undefined, [1]])(
  'sweep-installation refuses the installation id %s',
  (bad) => {
    expect(jobEnvelopeSchema.safeParse({ ...SWEEP_INSTALLATION, githubInstallationId: bad }).success).toBe(false);
  },
);

test('sweep-installation needs its installation id', () => {
  expect(jobEnvelopeSchema.safeParse({ type: 'sweep-installation' }).success).toBe(false);
});

test.each(['', 'finalise', 'sweep-repositories', 'job-dead-letter', 'constructor', '__proto__', 7, null, undefined])(
  'a job of type %s is not in the envelope',
  (type) => {
    expect(jobEnvelopeSchema.safeParse({ type, githubInstallationId: IDS.installation }).success).toBe(false);
  },
);

test.each([null, undefined, 'evaluate-pr', 7, [], [JOBS.evaluatePr], {}])(
  'data that is not a job (%j) is refused',
  (bad) => {
    expect(jobEnvelopeSchema.safeParse(bad).success).toBe(false);
  },
);

const parsed = (job: unknown) => jobEnvelopeSchema.parse(job);

// The repository-level jobs (E07-S09): the envelope of each refuses what a job of a change of policy must never carry.

test.each(['repository_enabled', 'cla_version_published', 'cla_document_changed', 'allowlist_changed'])(
  'sweep-repository takes the reason %s',
  (reason) => {
    expect(jobEnvelopeSchema.parse({ ...SWEEP_REPOSITORY, reason })).toEqual({ ...SWEEP_REPOSITORY, reason });
  },
);

test.each(['signature_revoked', 'signatures_invalidated', 'override_changed'])(
  'sweep-repository takes the reason %s as well',
  (reason) => {
    expect(jobEnvelopeSchema.parse({ ...SWEEP_REPOSITORY, reason })).toEqual({ ...SWEEP_REPOSITORY, reason });
  },
);

test('the reasons of sweep-repository are exactly the seven of the story and the two of E21 (S04 and S05), each once', () => {
  expect([...SWEEP_REPOSITORY_REASONS].toSorted((a, b) => a.localeCompare(b))).toEqual([
    'allowlist_changed',
    'cla_document_changed',
    'cla_version_published',
    'corporate_approval_revoked',
    'corporate_claim',
    'override_changed',
    'repository_enabled',
    'signature_revoked',
    'signatures_invalidated',
  ]);
});

test.each([
  '',
  'policy_change',
  'Repository_Enabled',
  'repository_enabled ',
  'allowlist-changed',
  7,
  null,
  undefined,
  {},
])('sweep-repository refuses the reason %j', (reason) => {
  expect(jobEnvelopeSchema.safeParse({ ...SWEEP_REPOSITORY, reason }).success).toBe(false);
});

/** `job` without its field `name`. */
const without = (job: object, name: string): object =>
  Object.fromEntries(Object.entries(job).filter(([key]) => key !== name));

test('sweep-repository needs its reason', () => {
  expect(jobEnvelopeSchema.safeParse(without(SWEEP_REPOSITORY, 'reason')).success).toBe(false);
});

const ID_FIELDS = ['githubInstallationId', 'githubRepoId'] as const;
const BAD_IDS = ['31001', '', 0, -1, 1.5, 2 ** 53, null, undefined, [1], { id: 1 }];

test.each(
  REPOSITORY_JOBS.flatMap((job) =>
    ID_FIELDS.flatMap((field) => BAD_IDS.map((bad) => ({ type: job.type, job, field, bad }))),
  ),
)('$type refuses $field = $bad', ({ job, field, bad }) => {
  expect(jobEnvelopeSchema.safeParse({ ...job, [field]: bad }).success).toBe(false);
});

test.each(REPOSITORY_JOBS.flatMap((job) => ID_FIELDS.map((field) => ({ type: job.type, job, field }))))(
  '$type needs $field',
  ({ job, field }) => {
    expect(jobEnvelopeSchema.safeParse(without(job, field)).success).toBe(false);
  },
);

test.each(['7', 0, -1, 1.5, 2 ** 53, null, undefined, [7]])(
  'finalise-check refuses the pull request number %j',
  (bad) => {
    expect(jobEnvelopeSchema.safeParse({ ...FINALISE_CHECK, prNumber: bad }).success).toBe(false);
  },
);

test.each([SWEEP_REPOSITORY, FINALISE_REPOSITORY])('$type takes no pull request number', (job) => {
  expect(jobEnvelopeSchema.safeParse({ ...job, prNumber: IDS.pullRequestNumber }).success).toBe(false);
});

test('finalise-repository and finalise-check take no reason: it is the reason of a sweep only', () => {
  expect(jobEnvelopeSchema.safeParse({ ...FINALISE_REPOSITORY, reason: 'repository_enabled' }).success).toBe(false);
  expect(jobEnvelopeSchema.safeParse({ ...FINALISE_CHECK, reason: 'repository_enabled' }).success).toBe(false);
});

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

test('the log fields of a sweep-repository are its ids and its reason, and those of a finalise-check its ids and the pull request', () => {
  expect(logFieldsOf(parsed(SWEEP_REPOSITORY))).toEqual({
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    reason: 'allowlist_changed',
  });
  expect(logFieldsOf(parsed(FINALISE_CHECK))).toEqual({
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    prNumber: IDS.pullRequestNumber,
  });
});

test('a job that carries no id has no log fields', () => {
  expect(logFieldsOf(parsed(SWEEP))).toEqual({});
  expect(logFieldsOf(parsed(RETENTION_SWEEP))).toEqual({});
});

test('retention-sweep carries no data at all: any field is refused, so nothing a job holds can steer the purge', () => {
  expect(jobEnvelopeSchema.parse({ type: 'retention-sweep' })).toEqual({ type: 'retention-sweep' });
  for (const field of [
    { days: 0 },
    { batchSize: 1 },
    { cutoff: '2026-01-01T00:00:00Z' },
    { githubInstallationId: 1 },
  ]) {
    expect(jobEnvelopeSchema.safeParse({ ...RETENTION_SWEEP, ...field }).success).toBe(false);
  }
});

test('a field of the wrong kind never reaches the log fields', () => {
  expect(logFieldsOf(Object.assign(parsed(SWEEP), { prNumber: { nested: CANARY } }))).toEqual({});
});
