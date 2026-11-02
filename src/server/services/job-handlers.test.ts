// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { JOB_TYPES } from '../domain/job-envelope.ts';
import { CLOSE_JOB, closeWorld, seedEvaluation } from './close-pr/test-support.ts';
import { evaluateWorld, JOB } from './evaluate-pr/test-support.ts';
import { comment, pullRef } from './github-comment-contract/test-support.ts';
import type { SyncOutcome } from './installation-sync-model.ts';
import { type HandlerDeps, HandlerUnavailableError, registerHandlers } from './job-handlers.ts';
import { HandlerRegisteredError, HandlerRegistry } from './job-registry.ts';
import { runJob } from './job-run.ts';
import { completing, DELIVERY_ID, IDS, JOBS, queuedJob, runWorld } from './job-run-fixture/test-support.ts';
import {
  COMMENT_ID,
  COMMENT_JOB,
  FULL_NAME,
  HEAD,
  HEAD_JOB,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
  recheckWorld,
} from './recheck/test-support.ts';
import type { SweepDeps } from './sweep/sweep.ts';
import { sweepWorld } from './sweep/test-support.ts';

// The handlers `registerHandlers` binds (E07-S03): the five of the deliveries and the two of the scheduler, with the
// sync of an installation wired to E05-S08, the evaluation, the close and the manual re-evaluation (E07-S04, E07-S06, E07-S07)
// wired to their code, and the scheduled sweep (E07-S08); a handler whose consumer is not available fails its jobs.

const DELIVERY_DRIVEN = ['evaluate-pr', 'evaluate-head-sha', 'close-pr', 'recheck-comment', 'sync-installation'];
const SYNCED: SyncOutcome = {
  status: 'synced',
  changed: true,
  repositories: { added: 1, renamed: 0, removed: 0 },
};

function registered(
  deps: HandlerDeps = { syncInstallation: () => Promise.resolve(SYNCED), evaluatePr: undefined },
): HandlerRegistry {
  const registry = new HandlerRegistry();
  registerHandlers(registry, deps);
  return registry;
}

test('the registry binds the five delivery-driven handlers and the two of the scheduler, all of them job types of the catalogue', () => {
  const types = registered().types();
  expect(types).toEqual(expect.arrayContaining(DELIVERY_DRIVEN));
  expect(types).toEqual([
    'evaluate-pr',
    'evaluate-head-sha',
    'close-pr',
    'recheck-comment',
    'sync-installation',
    'sweep',
    'sweep-installation',
  ]);
  for (const type of types) {
    expect(JOB_TYPES).toContain(type);
  }
});

test('revoke-user-sessions has no consumer until E10 registers one, and a later registration needs no change here', () => {
  const registry = registered();
  expect(registry.types()).not.toContain('revoke-user-sessions');
  const revoke = completing('revoked');
  registry.register('revoke-user-sessions', revoke);
  expect(registry.types()).toContain('revoke-user-sessions');
  expect(() => {
    registry.register('revoke-user-sessions', completing());
  }).toThrow(HandlerRegisteredError);
});

test('registering the handlers twice on one registry is refused, so no handler is bound by accident twice', () => {
  const registry = registered();
  expect(() => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: undefined });
  }).toThrow(HandlerRegisteredError);
});

test('sync-installation syncs the installation of the payload with the signal of the job and completes with the status', async () => {
  const sync = vi.fn<NonNullable<HandlerDeps['syncInstallation']>>(() => Promise.resolve(SYNCED));
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: sync, evaluatePr: undefined });
  });
  const signal = new AbortController().signal;
  const verdict = await runJob('sync-installation', queuedJob(JOBS.syncInstallation, { signal }), deps);
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'synced' } });
  expect(sync).toHaveBeenCalledExactlyOnceWith(parseGithubId(IDS.installation), signal);
  expect(marked).toEqual([DELIVERY_ID]);
});

test.each(['unknown', 'deleted', 'rejected', 'suspended'] as const)(
  'sync-installation completes with the status %s, which is not a failure',
  async (status) => {
    const { deps } = runWorld((registry) => {
      registerHandlers(registry, {
        syncInstallation: () => Promise.resolve({ ...SYNCED, status }),
        evaluatePr: undefined,
      });
    });
    const verdict = await runJob('sync-installation', queuedJob(JOBS.syncInstallation), deps);
    expect(verdict).toEqual({ status: 'completed', output: { outcome: status } });
  },
);

test('a sync that fails fails the job and leaves its delivery unmarked, so the queue retries it and GitHub may redeliver it', async () => {
  const failure = new Error('GitHub answered 500');
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: () => Promise.reject(failure), evaluatePr: undefined });
  });
  await expect(runJob('sync-installation', queuedJob(JOBS.syncInstallation), deps)).rejects.toBe(failure);
  expect(marked).toEqual([]);
});

test('the installation of the payload is only a key: the handler hands the sync nothing else of the job', async () => {
  const sync = vi.fn<NonNullable<HandlerDeps['syncInstallation']>>(() => Promise.resolve(SYNCED));
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: sync, evaluatePr: undefined });
  });
  await runJob('sync-installation', queuedJob(JOBS.syncInstallation), deps);
  expect(sync.mock.calls[0]).toHaveLength(2);
});

test('without a GitHub App a sync-installation job fails, so it is not completed and its delivery is not marked', async () => {
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: undefined });
  });
  await expect(runJob('sync-installation', queuedJob(JOBS.syncInstallation), deps)).rejects.toThrow(
    new HandlerUnavailableError('sync-installation', 'no GitHub App is configured'),
  );
  expect(marked).toEqual([]);
});

test('without an evaluation reporter an evaluate-pr job fails and keeps its delivery: the reporter is E09, and nothing is evaluated without it', async () => {
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: undefined });
  });
  await expect(runJob('evaluate-pr', queuedJob(JOBS.evaluatePr), deps)).rejects.toThrow(
    new HandlerUnavailableError('evaluate-pr', 'no GitHub App or no evaluation reporter (E09) is configured'),
  );
  expect(marked).toEqual([]);
});

test('evaluate-pr evaluates with the ports it is given for the signal of the job, and completes with the outcome and marks its delivery', async () => {
  const world = await evaluateWorld();
  const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>(() => world.ports);
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
  });
  const signal = new AbortController().signal;
  const verdict = await runJob('evaluate-pr', queuedJob({ ...JOB, deliveryId: DELIVERY_ID }, { signal }), deps);
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'evaluated' } });
  expect(evaluatePorts).toHaveBeenCalledExactlyOnceWith(signal);
  expect(marked).toEqual([DELIVERY_ID]);
});

test('evaluate-pr is told how often its job was retried: a retry is evaluated again where a first run would find the verdict', async () => {
  const world = await evaluateWorld();
  world.reporter.hooks.started = async (target) => {
    await world.raw
      .updateTable('pr_evaluations')
      .set({ check_run_id: 1 })
      .where('id', '=', target.evaluationId)
      .execute();
  };
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: () => world.ports });
  });
  const outcomes: unknown[] = [];
  for (const retryCount of [0, 0, 1]) {
    outcomes.push((await runJob('evaluate-pr', queuedJob(JOB, { retryCount }), deps)).output);
  }
  expect(outcomes).toEqual([{ outcome: 'evaluated' }, { outcome: 'unchanged' }, { outcome: 'evaluated' }]);
});

test('an evaluate-pr job whose payload is not an envelope is dead-lettered before the evaluation is asked for anything', async () => {
  const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>();
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
  });
  const verdict = await runJob('evaluate-pr', queuedJob({ type: 'evaluate-pr', prNumber: 'seven' }), deps);
  expect(verdict.status).toBe('deadletter');
  expect(evaluatePorts).not.toHaveBeenCalled();
});

test('without an evaluation reporter a close-pr job fails and keeps its delivery, like an evaluate-pr job', async () => {
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: undefined });
  });
  await expect(runJob('close-pr', queuedJob(JOBS.closePr), deps)).rejects.toThrow(
    new HandlerUnavailableError('close-pr', 'no GitHub App or no evaluation reporter (E09) is configured'),
  );
  expect(marked).toEqual([]);
});

test('close-pr prunes with the ports it is given for the signal of the job and the queue the job runs on, completes with the outcome and marks its delivery', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>(() => world.ports);
  const { deps, marked, pending } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
  });
  const signal = new AbortController().signal;
  const verdict = await runJob('close-pr', queuedJob({ ...CLOSE_JOB, deliveryId: DELIVERY_ID }, { signal }), deps);
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'closed' } });
  expect(evaluatePorts).toHaveBeenCalledExactlyOnceWith(signal);
  expect(pending.targets.map((target) => target.prNumber)).toEqual([CLOSE_JOB.prNumber]);
  expect((await world.rows()).map((row) => row.result)).toEqual(['cancelled']);
  expect(marked).toEqual([DELIVERY_ID]);
});

test('a close-pr job whose payload is not an envelope is dead-lettered before the ports are asked for anything', async () => {
  const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>();
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
  });
  const verdict = await runJob('close-pr', queuedJob({ type: 'close-pr', prNumber: 'seven' }), deps);
  expect(verdict.status).toBe('deadletter');
  expect(evaluatePorts).not.toHaveBeenCalled();
});

test.each([
  ['evaluate-head-sha', JOBS.evaluateHeadSha],
  ['recheck-comment', JOBS.recheckComment],
] as const)(
  'without an evaluation reporter a %s job fails and keeps its delivery, like an evaluate-pr job: what it sends could not be evaluated',
  async (type, data) => {
    const { deps, marked } = runWorld((registry) => {
      registerHandlers(registry, { syncInstallation: undefined, evaluatePr: undefined });
    });
    await expect(runJob(type, queuedJob(data), deps)).rejects.toThrow(
      new HandlerUnavailableError(type, 'no GitHub App or no evaluation reporter (E09) is configured'),
    );
    expect(marked).toEqual([]);
  },
);

test('recheck-comment reads the comment with the ports it is given for the signal of the job, sends the evaluation on the queue the job runs on, and marks its delivery', async () => {
  const world = await recheckWorld();
  const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>(() => world.ports);
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
  });
  const signal = new AbortController().signal;
  const job = queuedJob({ ...COMMENT_JOB, deliveryId: DELIVERY_ID }, { signal });
  const verdict = await runJob('recheck-comment', job, { ...deps, enqueuer: world.enqueuer });
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'enqueued' } });
  expect(evaluatePorts).toHaveBeenCalledExactlyOnceWith(signal);
  expect((await world.queued()).map((sent) => [sent.idempotencyKey, sent.job.type])).toEqual([
    [`recheck-comment:${COMMENT_ID}`, 'evaluate-pr'],
  ]);
  expect(marked).toEqual([DELIVERY_ID]);
});

test('a comment that is no command completes its job as skipped and still marks its delivery: there is nothing left to retry', async () => {
  const world = await recheckWorld();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT_ID, { body: 'thanks' }));
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: () => world.ports });
  });
  const verdict = await runJob('recheck-comment', queuedJob({ ...COMMENT_JOB, deliveryId: DELIVERY_ID }), {
    ...deps,
    enqueuer: world.enqueuer,
  });
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'skipped:not_a_command' } });
  expect(marked).toEqual([DELIVERY_ID]);
});

test('evaluate-head-sha sends an evaluation for each open pull request of the head SHA, named after the job, and marks its delivery', async () => {
  const world = await recheckWorld();
  world.fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, [pullRef(PR_NUMBER)]);
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: () => world.ports });
  });
  const job = queuedJob({ ...HEAD_JOB, deliveryId: DELIVERY_ID }, { id: 'job-9' });
  const verdict = await runJob('evaluate-head-sha', job, { ...deps, enqueuer: world.enqueuer });
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'enqueued' } });
  expect((await world.queued()).map((sent) => sent.idempotencyKey)).toEqual([`evaluate-head-sha:job-9:${PR_NUMBER}`]);
  expect(marked).toEqual([DELIVERY_ID]);
});

test.each([
  ['recheck-comment', { type: 'recheck-comment', prNumber: 'seven' }],
  ['evaluate-head-sha', { type: 'evaluate-head-sha', headSha: 'main' }],
] as const)(
  'a %s job whose payload is not an envelope is dead-lettered before the ports are asked for anything',
  async (type, data) => {
    const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>();
    const { deps } = runWorld((registry) => {
      registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
    });
    expect((await runJob(type, queuedJob(data), deps)).status).toBe('deadletter');
    expect(evaluatePorts).not.toHaveBeenCalled();
  },
);

const SWEEP_JOBS = [
  ['sweep', { type: 'sweep' }, 'no GitHub App is configured'],
  [
    'sweep-installation',
    { type: 'sweep-installation', githubInstallationId: IDS.installation },
    'no GitHub App or no evaluation reporter (E09) is configured',
  ],
] as const;

test.each(SWEEP_JOBS)(
  'a %s job fails without what it runs on and never completes with nothing done (E07-S08)',
  async (type, data, reason) => {
    const { deps, marked } = runWorld((registry) => {
      registerHandlers(registry, { syncInstallation: undefined, evaluatePr: undefined });
    });
    await expect(runJob(type, queuedJob(data), deps)).rejects.toThrow(new HandlerUnavailableError(type, reason));
    expect(marked).toEqual([]);
  },
);

test('a sweep fails without the sweep dependency also where the evaluation ports are there: the two jobs are bound separately', async () => {
  const world = await sweepWorld();
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, {
      syncInstallation: undefined,
      evaluatePr: () => world.evaluatePorts,
      sweep: undefined,
    });
  });
  await expect(runJob('sweep', queuedJob({ type: 'sweep' }), deps)).rejects.toBeInstanceOf(HandlerUnavailableError);
});

test('sweep reconciles the installations with the signal of the job, sends a sweep-installation job for each served one on the queue the job runs on, and completes', async () => {
  const world = await sweepWorld();
  const reconcileInstallations = vi.fn<SweepDeps['reconcileInstallations']>(() =>
    Promise.resolve({ synced: 1, failed: 0 }),
  );
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, {
      syncInstallation: undefined,
      evaluatePr: undefined,
      sweep: { db: world.db, reconcileInstallations },
    });
  });
  const signal = new AbortController().signal;
  const verdict = await runJob('sweep', queuedJob({ type: 'sweep' }, { id: 'job-4', signal }), {
    ...deps,
    enqueuer: world.enqueuer,
  });
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'fanned_out' } });
  expect(reconcileInstallations).toHaveBeenCalledExactlyOnceWith(signal);
  expect((await world.queued()).map((sent) => [sent.idempotencyKey, sent.job.type])).toEqual([
    [`sweep:job-4:${String(INSTALLATION)}`, 'sweep-installation'],
  ]);
});

test('sweep-installation sweeps with the ports it is given for the signal of the job, sends the evaluations on the queue the job runs on, and completes', async () => {
  const world = await sweepWorld();
  const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>(() => world.evaluatePorts);
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
  });
  const signal = new AbortController().signal;
  const job = queuedJob({ type: 'sweep-installation', githubInstallationId: INSTALLATION }, { id: 'job-5', signal });
  const verdict = await runJob('sweep-installation', job, { ...deps, enqueuer: world.enqueuer });
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'swept' } });
  expect(evaluatePorts).toHaveBeenCalledExactlyOnceWith(signal);
  expect((await world.queued()).map((sent) => [sent.idempotencyKey, sent.job.type])).toEqual([
    [`sweep:job-5:${String(REPOSITORY)}:${String(PR_NUMBER)}`, 'evaluate-pr'],
  ]);
});

test('a sweep-installation job whose payload is not an envelope is dead-lettered before the ports are asked for anything', async () => {
  const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>();
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
  });
  const data = { type: 'sweep-installation', githubInstallationId: 'five thousand' };
  expect((await runJob('sweep-installation', queuedJob(data), deps)).status).toBe('deadletter');
  expect(evaluatePorts).not.toHaveBeenCalled();
});
