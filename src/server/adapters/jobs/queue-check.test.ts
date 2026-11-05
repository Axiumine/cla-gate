// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { assertQueues, MissingQueuesError, missingQueues } from './queue-check.ts';
import { QueuePolicyError } from './queue-policy.ts';
import { QUEUE_DEFINITIONS, QUEUES } from './queues.ts';
import { fakeBoss } from './test-support.ts';

test('asks pg-boss for every queue of the constant and finds none missing when all exist', async () => {
  const boss = fakeBoss();
  expect(await missingQueues(boss)).toEqual([]);
  expect(boss.getQueues).toHaveBeenCalledExactlyOnceWith([...QUEUES]);
});

test('the missing queues come back in the order of the constant', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([{ name: 'sweep' }, { name: 'evaluate-pr' }, { name: 'not-ours' }]);
  expect(await missingQueues(boss)).toEqual([
    'evaluate-head-sha',
    'close-pr',
    'recheck-comment',
    'sync-installation',
    'revoke-user-sessions',
    'sweep-installation',
    'sweep-repository',
    'finalise-repository',
    'finalise-check',
    'retention-sweep',
    'job-dead-letter',
  ]);
});

test('a database with no queue at all lacks every one', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([]);
  expect(await missingQueues(boss)).toEqual([...QUEUES]);
});

test('the error names the queues, and only them', () => {
  const error = new MissingQueuesError(['sweep', 'close-pr']);
  expect(error.message).toBe('Job queues are missing: sweep, close-pr');
  expect(error.queues).toEqual(['sweep', 'close-pr']);
  expect(error.name).toBe('MissingQueuesError');
  expect(error).toBeInstanceOf(Error);
});

const EXISTING = QUEUE_DEFINITIONS.map(({ name, policy }) => ({ name, policy }));

test('the check passes when every queue exists with its policy, after one read of the queues', async () => {
  const boss = fakeBoss();
  await expect(assertQueues(boss)).resolves.toBeUndefined();
  expect(boss.getQueues).toHaveBeenCalledExactlyOnceWith([...QUEUES]);
});

test('the check names the missing queues before it looks at any policy', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([{ name: 'evaluate-pr', policy: 'standard' }]);
  const error = await assertQueues(boss).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MissingQueuesError);
  expect(error).toMatchObject({ queues: QUEUES.filter((name) => name !== 'evaluate-pr') });
});

test('the check refuses a queue of the wrong policy', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce(
    EXISTING.map((queue) => (queue.name === 'evaluate-pr' ? { ...queue, policy: 'standard' } : queue)),
  );
  const error = await assertQueues(boss).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(QueuePolicyError);
  expect(error).toMatchObject({ mismatches: [{ queue: 'evaluate-pr', found: 'standard', expected: 'singleton' }] });
});

test('a database made by a build before E07-S09 lacks the three queues of the repository-level jobs, and the start-up check names them', async () => {
  const boss = fakeBoss();
  const later = ['sweep-repository', 'finalise-repository', 'finalise-check'];
  boss.getQueues.mockResolvedValueOnce(
    QUEUE_DEFINITIONS.filter(({ name }) => !later.includes(name)).map(({ name, policy }) => ({ name, policy })),
  );
  const failure = await assertQueues(boss).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(MissingQueuesError);
  expect(failure).toMatchObject({ queues: later });
  expect(failure).toHaveProperty(
    'message',
    'Job queues are missing: sweep-repository, finalise-repository, finalise-check',
  );
});
