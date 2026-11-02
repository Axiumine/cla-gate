// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { JOB_TYPES } from '../domain/job-envelope.ts';
import type { SyncOutcome } from './installation-sync-model.ts';
import { type HandlerDeps, HandlerUnavailableError, registerHandlers } from './job-handlers.ts';
import { HandlerRegisteredError, HandlerRegistry } from './job-registry.ts';
import { runJob } from './job-run.ts';
import { completing, DELIVERY_ID, IDS, JOBS, queuedJob, runWorld } from './job-run-fixture/test-support.ts';

// The handlers `registerHandlers` binds (E07-S03): the five of the deliveries and the two of the scheduler, with the
// sync of an installation wired to E05-S08 and the others failing their jobs until their stories land.

const DELIVERY_DRIVEN = ['evaluate-pr', 'evaluate-head-sha', 'close-pr', 'recheck-comment', 'sync-installation'];
const SYNCED: SyncOutcome = {
  status: 'synced',
  changed: true,
  repositories: { added: 1, renamed: 0, removed: 0 },
};

function registered(deps: HandlerDeps = { syncInstallation: () => Promise.resolve(SYNCED) }): HandlerRegistry {
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
    registerHandlers(registry, { syncInstallation: undefined });
  }).toThrow(HandlerRegisteredError);
});

test('sync-installation syncs the installation of the payload with the signal of the job and completes with the status', async () => {
  const sync = vi.fn<NonNullable<HandlerDeps['syncInstallation']>>(() => Promise.resolve(SYNCED));
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: sync });
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
      registerHandlers(registry, { syncInstallation: () => Promise.resolve({ ...SYNCED, status }) });
    });
    const verdict = await runJob('sync-installation', queuedJob(JOBS.syncInstallation), deps);
    expect(verdict).toEqual({ status: 'completed', output: { outcome: status } });
  },
);

test('a sync that fails fails the job and leaves its delivery unmarked, so the queue retries it and GitHub may redeliver it', async () => {
  const failure = new Error('GitHub answered 500');
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: () => Promise.reject(failure) });
  });
  await expect(runJob('sync-installation', queuedJob(JOBS.syncInstallation), deps)).rejects.toBe(failure);
  expect(marked).toEqual([]);
});

test('the installation of the payload is only a key: the handler hands the sync nothing else of the job', async () => {
  const sync = vi.fn<NonNullable<HandlerDeps['syncInstallation']>>(() => Promise.resolve(SYNCED));
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: sync });
  });
  await runJob('sync-installation', queuedJob(JOBS.syncInstallation), deps);
  expect(sync.mock.calls[0]).toHaveLength(2);
});

test('without a GitHub App a sync-installation job fails, so it is not completed and its delivery is not marked', async () => {
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined });
  });
  await expect(runJob('sync-installation', queuedJob(JOBS.syncInstallation), deps)).rejects.toThrow(
    new HandlerUnavailableError('sync-installation', 'no GitHub App is configured'),
  );
  expect(marked).toEqual([]);
});

const NOT_BUILT = [
  ['evaluate-pr', JOBS.evaluatePr, 'E07-S04'],
  ['evaluate-head-sha', JOBS.evaluateHeadSha, 'E07-S07'],
  ['close-pr', JOBS.closePr, 'E07-S06'],
  ['recheck-comment', JOBS.recheckComment, 'E07-S07'],
  ['sweep', { type: 'sweep' }, 'E07-S08'],
  ['sweep-installation', { type: 'sweep-installation', githubInstallationId: IDS.installation }, 'E07-S08'],
] as const;

test.each(NOT_BUILT)(
  'a %s job fails until its story is built (%s... names it) and never completes with nothing done, so no delivery is lost',
  async (type, data, story) => {
    const { deps, marked } = runWorld((registry) => {
      registerHandlers(registry, { syncInstallation: undefined });
    });
    const error = await runJob(type, queuedJob(data), deps).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HandlerUnavailableError);
    expect(error).toMatchObject({ type });
    expect(String(error)).toContain(story);
    expect(marked).toEqual([]);
  },
);
