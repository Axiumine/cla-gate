// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createLogger } from '../adapters/http/logger.ts';
import { JOB_TYPES } from '../domain/job-envelope.ts';
import { HandlerMissingError, HandlerRegisteredError, HandlerRegistry } from './job-registry.ts';
import { completing, IDS, queuedJob, recording } from './job-run-fixture/test-support.ts';

// The handler registry (E07-S03): one handler per job type, registered by whoever owns the job.

const context = {
  jobId: 'job-1',
  attempt: 0,
  signal: queuedJob(null).signal,
  logger: createLogger({ logLevel: 'silent' }),
};
const SYNC = { type: 'sync-installation', githubInstallationId: parseGithubId(IDS.installation) } as const;

test('a new registry has no handler', () => {
  expect(new HandlerRegistry().types()).toEqual([]);
});

test('the types with a handler come back in the order of the catalogue, whatever the order of registration', () => {
  const registry = new HandlerRegistry();
  registry.register('sweep', completing());
  registry.register('evaluate-pr', completing());
  registry.register('sync-installation', completing());
  expect(registry.types()).toEqual(['evaluate-pr', 'sync-installation', 'sweep']);
});

test('every type a registry can hold is a job type of the envelope', () => {
  const registry = new HandlerRegistry();
  for (const type of JOB_TYPES) {
    registry.register(type, completing());
  }
  expect(registry.types()).toEqual(JOB_TYPES);
});

test('a type has one handler: registering a second one is refused, and the first stays', async () => {
  const registry = new HandlerRegistry();
  const first = completing('first');
  registry.register('sync-installation', first);
  expect(() => {
    registry.register('sync-installation', completing('second'));
  }).toThrow(new HandlerRegisteredError('sync-installation'));
  expect(await registry.run('sync-installation', SYNC, context)).toEqual({
    outcome: 'first',
  });
});

test('run calls the handler of the type with the envelope and the context, and answers its outcome', async () => {
  const registry = new HandlerRegistry();
  const handler = recording<'sync-installation'>('synced');
  registry.register('sync-installation', handler);
  expect(await registry.run('sync-installation', SYNC, context)).toEqual({ outcome: 'synced' });
  expect(handler).toHaveBeenCalledExactlyOnceWith(SYNC, context);
});

test('run for a type nobody registered rejects with a HandlerMissingError naming the type', async () => {
  const registry = new HandlerRegistry();
  const job = { type: 'sweep' } as const;
  await expect(registry.run('sweep', job, context)).rejects.toThrow(new HandlerMissingError('sweep'));
  await expect(registry.run('sweep', job, context)).rejects.toThrow('No handler is registered for sweep');
});

test('two registries do not share handlers', () => {
  const first = new HandlerRegistry();
  first.register('sweep', completing());
  expect(new HandlerRegistry().types()).toEqual([]);
});
