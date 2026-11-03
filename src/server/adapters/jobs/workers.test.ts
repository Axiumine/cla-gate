// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { JOB_TYPES } from '../../domain/job-envelope.ts';
import type { HandlerRegistry } from '../../services/job-registry.ts';
import { completing, JOBS, runWorld } from '../../services/job-run-fixture/test-support.ts';
import type { WorkerJob } from './boss.ts';
import { QUEUES } from './queues.ts';
import { fakeBoss } from './test-support.ts';
import { Workers, type WorkersOptions } from './workers.ts';

// The pg-boss workers around the wrapper (E07-S03), with a pg-boss that is only a script. Against a real server:
// workers-real.test.ts.

function world(register: (registry: HandlerRegistry) => void, options: Partial<WorkersOptions> = {}) {
  const run = runWorld(register);
  const workers = new Workers({ ...run.deps, concurrency: 4, ...options });
  return { ...run, workers, boss: fakeBoss() };
}

/** What `boss.work` was given for `name`: its options and its handler. */
function workerOf(boss: ReturnType<typeof fakeBoss>, name: string) {
  const call = boss.work.mock.calls.find(([queue]) => queue === name);
  if (call === undefined) {
    throw new Error(`no worker for ${name}`);
  }
  return { options: call[1], handler: call[2] };
}

const job = (data: unknown, overrides: Partial<WorkerJob> = {}): WorkerJob => ({
  id: 'job-1',
  data,
  retryCount: 0,
  signal: new AbortController().signal,
  ...overrides,
});

test('every job type of the envelope has a queue, so a worker can be started for it', () => {
  for (const type of JOB_TYPES) {
    expect(QUEUES).toContain(type);
  }
});

test('a worker is started for every type that has a handler and for no other queue', async () => {
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', completing());
    registry.register('sweep', completing());
  });
  await workers.start(boss);
  expect(boss.work.mock.calls.map(([name]) => name)).toEqual(['sync-installation', 'sweep']);
});

test('a type without a handler gets no worker: revoke-user-sessions keeps its jobs until E10 registers one', async () => {
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', completing());
  });
  await workers.start(boss);
  expect(boss.work.mock.calls.map(([name]) => name)).not.toContain('revoke-user-sessions');
  expect(boss.work.mock.calls.map(([name]) => name)).not.toContain('job-dead-letter');
});

test('each queue is worked with the concurrency of the configuration, one job per fetch, settled by the handler', async () => {
  const { workers, boss } = world(
    (registry) => {
      registry.register('sync-installation', completing());
    },
    { concurrency: 7 },
  );
  await workers.start(boss);
  expect(workerOf(boss, 'sync-installation').options).toEqual({
    localConcurrency: 7,
    batchSize: 1,
    perJobResults: true,
  });
});

test('the polling interval is passed on when one is given, and left to pg-boss otherwise', async () => {
  const { workers, boss } = world(
    (registry) => {
      registry.register('sync-installation', completing());
    },
    { pollingIntervalSeconds: 0.5 },
  );
  await workers.start(boss);
  expect(workerOf(boss, 'sync-installation').options).toMatchObject({ pollingIntervalSeconds: 0.5 });
});

test('a worker that cannot start rejects the start with its error', async () => {
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', completing());
  });
  boss.work.mockRejectedValueOnce(new Error('queue does not exist'));
  await expect(workers.start(boss)).rejects.toThrow('queue does not exist');
});

test('a job that completes is settled completed with the outcome of its handler, under its own id', async () => {
  const { workers, boss, marked } = world((registry) => {
    registry.register('sync-installation', () => Promise.resolve({ outcome: 'synced' }));
  });
  await workers.start(boss);
  const results = await workerOf(boss, 'sync-installation').handler([job(JOBS.syncInstallation, { id: 'job-42' })]);
  expect(results).toEqual([{ id: 'job-42', status: 'completed', output: { outcome: 'synced' } }]);
  expect(marked).toHaveLength(1);
});

test('a job whose data is invalid is rejected, not retried: completed as rejected, and a copy of its data goes to the dead-letter queue under its id (E07-S05)', async () => {
  const { workers, boss, marked } = world((registry) => {
    registry.register('sync-installation', completing());
  });
  await workers.start(boss);
  const data = { type: 'sync-installation' };
  const results = await workerOf(boss, 'sync-installation').handler([job(data, { id: 'job-9' })]);
  expect(results).toEqual([{ id: 'job-9', status: 'completed', output: { rejected: 'invalid_payload' } }]);
  expect(boss.send).toHaveBeenCalledExactlyOnceWith('job-dead-letter', data, { id: 'job-9' });
  expect(marked).toEqual([]);
});

test.each([
  ['null', null],
  ['a string', 'sync-installation'],
  ['a number', 7],
  ['an array', [{ type: 'sync-installation' }]],
])(
  'data that is %s cannot be copied as it is: the copy is an empty object, the job is rejected all the same',
  async (_name, data) => {
    const { workers, boss } = world((registry) => {
      registry.register('sync-installation', completing());
    });
    await workers.start(boss);
    const results = await workerOf(boss, 'sync-installation').handler([job(data, { id: 'job-9' })]);
    expect(results).toMatchObject([{ id: 'job-9', status: 'completed', output: { rejected: 'invalid_payload' } }]);
    expect(boss.send).toHaveBeenCalledExactlyOnceWith('job-dead-letter', {}, { id: 'job-9' });
  },
);

test('a rejection whose copy cannot be sent fails the batch, so the job is retried and rejected again', async () => {
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', completing());
  });
  boss.send.mockRejectedValueOnce(new Error('the database went away'));
  await workers.start(boss);
  await expect(
    workerOf(boss, 'sync-installation').handler([job({ type: 'sync-installation' }, { id: 'job-9' })]),
  ).rejects.toThrow('the database went away');
});

test('a job that is valid sends no copy anywhere', async () => {
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', completing());
  });
  await workers.start(boss);
  await workerOf(boss, 'sync-installation').handler([job(JOBS.syncInstallation)]);
  expect(boss.send).not.toHaveBeenCalled();
});

test('a handler that throws makes the worker reject, so pg-boss fails the job and retries it', async () => {
  const failure = new Error('GitHub is down');
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', () => Promise.reject(failure));
  });
  await workers.start(boss);
  await expect(workerOf(boss, 'sync-installation').handler([job(JOBS.syncInstallation)])).rejects.toBe(failure);
});

test('before a stop nothing is aborted: an idle worker pool drained', () => {
  const { workers } = world(() => undefined);
  expect(workers.outcome()).toBe('drained');
});

test('a job still running when the stop is over means the shutdown aborted it', async () => {
  const running = Promise.withResolvers<{ outcome: string }>();
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', () => running.promise);
  });
  await workers.start(boss);
  workers.beginStop();
  const handling = workerOf(boss, 'sync-installation').handler([job(JOBS.syncInstallation)]);
  expect(workers.outcome()).toBe('aborted');
  running.resolve({ outcome: 'synced' });
  await handling;
  expect(workers.outcome()).toBe('drained');
});

test('a job that stopped on the signal of the shutdown means the shutdown aborted it, after the handler returned too', async () => {
  const abort = new AbortController();
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', (_job, { signal }) => {
      abort.abort(new Error('grace period over'));
      signal.throwIfAborted();
      return Promise.resolve({ outcome: 'unreachable' });
    });
  });
  await workers.start(boss);
  workers.beginStop();
  await expect(
    workerOf(boss, 'sync-installation').handler([job(JOBS.syncInstallation, { signal: abort.signal })]),
  ).rejects.toThrow('grace period over');
  expect(workers.outcome()).toBe('aborted');
});

test('a job that fails for another reason during the stop is not an abort', async () => {
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', () => Promise.reject(new Error('GitHub is down')));
  });
  await workers.start(boss);
  workers.beginStop();
  await expect(workerOf(boss, 'sync-installation').handler([job(JOBS.syncInstallation)])).rejects.toThrow(
    'GitHub is down',
  );
  expect(workers.outcome()).toBe('drained');
});

test('a signal that aborted before the stop began (the job expired) is not counted as an abort of the shutdown', async () => {
  const abort = new AbortController();
  const { workers, boss } = world((registry) => {
    registry.register('sync-installation', () => {
      abort.abort(new Error('expired'));
      return Promise.reject(new Error('expired'));
    });
  });
  await workers.start(boss);
  await expect(
    workerOf(boss, 'sync-installation').handler([job(JOBS.syncInstallation, { signal: abort.signal })]),
  ).rejects.toThrow('expired');
  workers.beginStop();
  expect(workers.outcome()).toBe('drained');
});

test('a handler is given the queue it runs on: what it cancels through its context is cancelled on the pg-boss the workers were started on', async () => {
  const { workers, boss } = world((registry) => {
    registry.register('close-pr', async (job, { pending }) => {
      const cancelled = await pending.cancelForPullRequest({
        githubInstallationId: job.githubInstallationId,
        githubRepoId: job.githubRepoId,
        prNumber: job.prNumber,
        headShas: [],
      });
      return { outcome: `cancelled ${cancelled}` };
    });
  });
  boss.findJobs.mockResolvedValueOnce([{ id: 'queued-1', state: 'created' }]);
  await workers.start(boss);
  const [result] = await workerOf(boss, 'close-pr').handler([job(JOBS.closePr)]);
  expect(result).toMatchObject({ status: 'completed', output: { outcome: 'cancelled 1' } });
  expect(boss.findJobs).toHaveBeenCalledWith('evaluate-pr', {
    data: {
      githubInstallationId: JOBS.closePr.githubInstallationId,
      githubRepoId: JOBS.closePr.githubRepoId,
      prNumber: JOBS.closePr.prNumber,
    },
    queued: true,
  });
  expect(boss.cancel).toHaveBeenCalledExactlyOnceWith('evaluate-pr', ['queued-1']);
});
