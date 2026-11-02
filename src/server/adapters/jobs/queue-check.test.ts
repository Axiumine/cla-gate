// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { MissingQueuesError, missingQueues } from './queue-check.ts';
import { QUEUES } from './queues.ts';
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
