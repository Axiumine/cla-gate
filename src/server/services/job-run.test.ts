// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CANARY } from '../domain/test-support.ts';
import type { JobHandler } from './job-registry.ts';
import { JOB_PAYLOAD_INVALID, runJob } from './job-run.ts';
import { completing, DELIVERY_ID, IDS, JOBS, queuedJob, recording, runWorld } from './job-run-fixture/test-support.ts';
import { GitHubRateLimitedError } from './ports/github-errors.ts';

// The wrapper around every handler (E07-S03): validation, the log lines, the delivery a finished job marks processed, the
// verdict, and what happens when the handler fails.

const SYNC = JOBS.syncInstallation;

test('a valid job runs its handler with the envelope and a context carrying the job id, the attempt and the signal, and completes with its outcome', async () => {
  const handler = recording<'sync-installation'>('synced');
  const { deps } = runWorld((registry) => {
    registry.register('sync-installation', handler);
  });
  const signal = new AbortController().signal;
  const verdict = await runJob('sync-installation', queuedJob(SYNC, { id: 'job-7', retryCount: 2, signal }), deps);
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'synced' } });
  expect(handler).toHaveBeenCalledOnce();
  expect(handler.mock.calls[0]?.[0]).toEqual(SYNC);
  expect(handler.mock.calls[0]?.[1]).toMatchObject({ jobId: 'job-7', attempt: 2, signal });
});

test('it logs the start and the finish with the job id, the type, the attempt, the numeric ids and the duration, and nothing else', async () => {
  const { deps, clock, logs } = runWorld((registry) => {
    registry.register('sync-installation', () => {
      clock.advance(250);
      return Promise.resolve({ outcome: 'unchanged' });
    });
  });
  await runJob('sync-installation', queuedJob(SYNC, { id: 'job-7', retryCount: 1 }), deps);
  expect(logs.lines()).toMatchObject([
    {
      level: 30,
      msg: 'job.started',
      jobId: 'job-7',
      type: 'sync-installation',
      attempt: 1,
      githubInstallationId: IDS.installation,
      deliveryId: DELIVERY_ID,
    },
    {
      level: 30,
      msg: 'job.finished',
      jobId: 'job-7',
      type: 'sync-installation',
      outcome: 'unchanged',
      durationMs: 250,
    },
  ]);
});

test('the log line of an evaluation names the repository, the pull request and the trigger, never the head sha or the data of the job', async () => {
  const { deps, logs } = runWorld((registry) => {
    registry.register('evaluate-pr', () => Promise.resolve({ outcome: 'success' }));
  });
  await runJob('evaluate-pr', queuedJob(JOBS.evaluatePr), deps);
  expect(logs.lines()[0]).toMatchObject({
    githubRepoId: IDS.repository,
    prNumber: IDS.pullRequestNumber,
    trigger: 'pull_request',
  });
  expect(logs.text()).not.toContain('"data"');
});

test('the handler can log through the context, and the line carries the job id and the ids', async () => {
  const { deps, logs } = runWorld((registry) => {
    registry.register('sync-installation', ({ githubInstallationId }, { logger }) => {
      logger.info({ githubInstallationId }, 'sync.step');
      return Promise.resolve({ outcome: 'synced' });
    });
  });
  await runJob('sync-installation', queuedJob(SYNC, { id: 'job-9' }), deps);
  expect(logs.lines().find((line) => line['msg'] === 'sync.step')).toMatchObject({
    jobId: 'job-9',
    type: 'sync-installation',
    githubInstallationId: IDS.installation,
  });
});

test('a job that completes and carries a delivery marks that delivery processed, once, after its handler', async () => {
  const order: string[] = [];
  const { deps, marked } = runWorld(
    (registry) => {
      registry.register('sync-installation', () => {
        order.push('handler');
        return Promise.resolve({ outcome: 'synced' });
      });
    },
    (deliveryId) => {
      order.push(`mark ${deliveryId}`);
      return Promise.resolve();
    },
  );
  await runJob('sync-installation', queuedJob(SYNC), deps);
  expect(order).toEqual(['handler', `mark ${DELIVERY_ID}`]);
  expect(marked).toEqual([]);
});

test('a job without a delivery (a sweep, a signature) marks nothing', async () => {
  const { deps, marked } = runWorld((registry) => {
    registry.register('sweep', () => Promise.resolve({ outcome: 'enqueued' }));
    registry.register('sync-installation', () => Promise.resolve({ outcome: 'synced' }));
  });
  await runJob('sweep', queuedJob({ type: 'sweep' }), deps);
  await runJob(
    'sync-installation',
    queuedJob({ type: 'sync-installation', githubInstallationId: IDS.installation }),
    deps,
  );
  expect(marked).toEqual([]);
});

const INVALID: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['a string', 'sync-installation'],
  ['an empty object', {}],
  ['an unknown type', { type: 'sweep-repository', githubInstallationId: IDS.installation }],
  ['an id that is a string', { ...SYNC, githubInstallationId: String(IDS.installation) }],
  ['an id that is zero', { ...SYNC, githubInstallationId: 0 }],
  ['a missing id', { type: 'sync-installation' }],
  ['a delivery that is not a UUID', { ...SYNC, deliveryId: 'not-a-uuid' }],
  ['a key the envelope does not declare', { ...SYNC, title: CANARY }],
];

test.each(INVALID)(
  'data that is %s fails permanently with job_payload_invalid: no handler runs, nothing is marked',
  async (_name, data) => {
    const handler = completing();
    const { deps, marked } = runWorld((registry) => {
      registry.register('sync-installation', handler);
    });
    const verdict = await runJob('sync-installation', queuedJob(data, { id: 'job-3' }), deps);
    expect(verdict).toMatchObject({ status: 'deadletter', output: { code: JOB_PAYLOAD_INVALID } });
    expect(handler).not.toHaveBeenCalled();
    expect(marked).toEqual([]);
  },
);

test('the code of an invalid payload is the one the story names', () => {
  expect(JOB_PAYLOAD_INVALID).toBe('job_payload_invalid');
});

test('an invalid payload is logged at warn with the field and why it failed, never the value', async () => {
  const { deps, logs } = runWorld((registry) => {
    registry.register('sync-installation', completing());
  });
  const verdict = await runJob(
    'sync-installation',
    queuedJob({ ...SYNC, githubInstallationId: `${CANARY}-id`, title: CANARY }, { id: 'job-3', retryCount: 4 }),
    deps,
  );
  expect(verdict.output).toEqual({
    code: 'job_payload_invalid',
    issues: ['githubInstallationId:invalid_type', '(object):unrecognized_keys'],
  });
  expect(logs.lines()).toMatchObject([
    {
      level: 40,
      msg: 'job.payload_invalid',
      jobId: 'job-3',
      type: 'sync-installation',
      attempt: 4,
      issues: ['githubInstallationId:invalid_type', '(object):unrecognized_keys'],
    },
  ]);
  expect(logs.text()).not.toContain(CANARY);
});

test('a valid job of another type on the queue is invalid too: the type of the data must be the type of the queue', async () => {
  const handler = completing();
  const { deps } = runWorld((registry) => {
    registry.register('sync-installation', handler);
  });
  const verdict = await runJob('sync-installation', queuedJob(JOBS.closePr), deps);
  expect(verdict).toEqual({
    status: 'deadletter',
    output: { code: 'job_payload_invalid', issues: ['type:wrong_queue'] },
  });
  expect(handler).not.toHaveBeenCalled();
});

test('a handler that throws is logged at warn with the error and the duration, and the error is rethrown: the job fails and is retried', async () => {
  const failure = new Error('GitHub is down');
  const { deps, clock, logs, marked } = runWorld((registry) => {
    registry.register('sync-installation', () => {
      clock.advance(40);
      return Promise.reject(failure);
    });
  });
  await expect(runJob('sync-installation', queuedJob(SYNC), deps)).rejects.toBe(failure);
  expect(marked).toEqual([]);
  expect(logs.lines().map((line) => line['msg'])).toEqual(['job.started', 'job.failed']);
  expect(logs.lines()[1]).toMatchObject({ level: 40, durationMs: 40, err: { message: 'GitHub is down' } });
});

test('a rate limit that the GitHub client refused to wait out is not caught: the same error leaves the wrapper, so the queue backs off', async () => {
  const limited = new GitHubRateLimitedError(120, 'primary');
  const { deps, marked } = runWorld((registry) => {
    registry.register('sync-installation', () => Promise.reject(limited));
  });
  await expect(runJob('sync-installation', queuedJob(SYNC), deps)).rejects.toBe(limited);
  expect(marked).toEqual([]);
});

test('a delivery that cannot be marked fails the job instead of completing it: it is retried and marked then', async () => {
  const failure = new Error('database is down');
  const { deps, logs } = runWorld(
    (registry) => {
      registry.register('sync-installation', completing());
    },
    () => Promise.reject(failure),
  );
  await expect(runJob('sync-installation', queuedJob(SYNC), deps)).rejects.toBe(failure);
  expect(logs.lines().map((line) => line['msg'])).toEqual(['job.started', 'job.failed']);
});

test('a job whose signal aborted is not completed, even when its handler ignored the signal and finished: it fails with the reason and marks nothing', async () => {
  const abort = new AbortController();
  const reason = new Error('the shutdown deadline passed');
  const { deps, marked, logs } = runWorld((registry) => {
    registry.register('sync-installation', () => {
      abort.abort(reason);
      return Promise.resolve({ outcome: 'synced' });
    });
  });
  await expect(runJob('sync-installation', queuedJob(SYNC, { signal: abort.signal }), deps)).rejects.toBe(reason);
  expect(marked).toEqual([]);
  expect(logs.lines().map((line) => line['msg'])).toEqual(['job.started', 'job.failed']);
});

test('a handler that stops on the signal fails the job with what it threw', async () => {
  const abort = new AbortController();
  const stopped = new Error('stopped on the signal');
  const handler: JobHandler<'sync-installation'> = (_job, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(stopped);
      });
    });
  const { deps, marked } = runWorld((registry) => {
    registry.register('sync-installation', handler);
  });
  const running = runJob('sync-installation', queuedJob(SYNC, { signal: abort.signal }), deps);
  abort.abort();
  await expect(running).rejects.toBe(stopped);
  expect(marked).toEqual([]);
});

test('a type without a handler fails the job with a plain error, so nothing is completed that nobody ran', async () => {
  const { deps, marked } = runWorld(() => undefined);
  await expect(runJob('sync-installation', queuedJob(SYNC), deps)).rejects.toThrow(
    'No handler is registered for sync-installation',
  );
  expect(marked).toEqual([]);
});
