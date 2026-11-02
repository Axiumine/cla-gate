// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { QueuedJob } from '../../services/ports/jobs.ts';
import { QUEUE_DEFINITIONS } from './queues.ts';
import { serialisationKey } from './serialisation.ts';

// The serialisation key of a job (E07-S02). That jobs with one key never overlap in a real queue is shown on a real
// PostgreSQL in serialisation-real.test.ts and serialisation-interleavings.test.ts.

const INSTALLATION = parseGithubId(70_001);
const GUID = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';
const SHA = 'a'.repeat(40);

function evaluation(overrides: Partial<Extract<QueuedJob, { type: 'evaluate-pr' }>> = {}): QueuedJob {
  return {
    type: 'evaluate-pr',
    githubInstallationId: INSTALLATION,
    githubRepoId: parseGithubId(9001),
    prNumber: 42,
    trigger: 'pull_request',
    ...overrides,
  };
}

/** One job of every type of the catalogue. */
const SAMPLES: readonly QueuedJob[] = [
  evaluation(),
  { type: 'evaluate-head-sha', githubInstallationId: INSTALLATION, githubRepoId: parseGithubId(9001), headSha: SHA },
  { type: 'close-pr', githubInstallationId: INSTALLATION, githubRepoId: parseGithubId(9001), prNumber: 42 },
  {
    type: 'recheck-comment',
    githubInstallationId: INSTALLATION,
    githubRepoId: parseGithubId(9001),
    prNumber: 42,
    commentId: parseGithubId(555),
  },
  { type: 'sync-installation', githubInstallationId: INSTALLATION },
  { type: 'revoke-user-sessions', githubUserId: parseGithubId(31_337) },
  { type: 'sweep-installation', githubInstallationId: INSTALLATION },
];

test('the key of an evaluate-pr job is the repository id and the pull request number', () => {
  expect(serialisationKey(evaluation())).toBe('9001:42');
});

test('the key does not depend on the trigger, the delivery or the installation: they are the same pull request', () => {
  const keys = (['pull_request', 'recheck', 'check_rerequested', 'signature', 'sweep', 'policy_change'] as const).map(
    (trigger) => serialisationKey(evaluation({ trigger, deliveryId: GUID, githubInstallationId: parseGithubId(1) })),
  );
  expect(new Set(keys)).toEqual(new Set(['9001:42']));
});

test.each([
  ['the same number in another repository', evaluation({ githubRepoId: parseGithubId(9002) }), '9002:42'],
  ['another number in the same repository', evaluation({ prNumber: 43 }), '9001:43'],
  [
    'ids that would join into the same digits',
    evaluation({ githubRepoId: parseGithubId(90), prNumber: 142 }),
    '90:142',
  ],
])('%s is another key', (_case, job, key) => {
  expect(serialisationKey(job)).toBe(key);
  expect(serialisationKey(job)).not.toBe(serialisationKey(evaluation()));
});

test('a job of a type that is not serialised has no key', () => {
  expect(SAMPLES.filter((job) => job.type !== 'evaluate-pr').map(serialisationKey)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

test('a queue has the singleton policy exactly when its jobs have a serialisation key', () => {
  const policies = new Map<string, string>(QUEUE_DEFINITIONS.map(({ name, policy }) => [name, policy]));
  for (const job of SAMPLES) {
    expect(policies.get(job.type) === 'singleton').toBe(serialisationKey(job) !== undefined);
  }
});
