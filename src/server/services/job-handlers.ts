// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { JobType } from '../domain/job-envelope.ts';
import type { SyncOutcome } from './installation-sync-model.ts';
import type { HandlerRegistry, JobHandler } from './job-registry.ts';

// The handlers the job queue binds (E07-S03). `registerHandlers` is the one list of what runs which job: a story that
// builds a handler replaces its line here. `revoke-user-sessions` is not in it, its consumer comes with E10-S07, which
// registers it through the registry from its own code; until then its queue keeps the jobs.

/**
 * Thrown by the handler of a job type whose consumer is not available: the job fails (it is retried, then dead-lettered)
 * instead of being completed with nothing done.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export class HandlerUnavailableError extends Error {
  override readonly name = 'HandlerUnavailableError';
  readonly type: JobType;

  constructor(type: JobType, reason: string) {
    super(`The ${type} job cannot run: ${reason}`);
    this.type = type;
  }
}

/** What the handlers need from the rest of the application. */
export interface HandlerDeps {
  /**
   * Re-fetches one installation and its repositories and stores what changed (E05-S08), with its GitHub requests bound to
   * the signal of the job. Undefined when no GitHub App is configured: the handler then fails every job.
   */
  readonly syncInstallation:
    | ((githubInstallationId: GithubId, signal: AbortSignal) => Promise<SyncOutcome>)
    | undefined;
}

/**
 * A handler for a job whose consumer is not available: it fails the job. A job that completes marks its delivery
 * processed, so completing without doing the work would lose the delivery; failing keeps it, and GitHub's redelivery
 * or the retries of the queue find a working handler once there is one.
 */
function unavailable<T extends JobType>(type: T, reason: string): JobHandler<T> {
  return () => Promise.reject(new HandlerUnavailableError(type, reason));
}

/** `sync-installation`: the numbers of the payload are keys only, GitHub is asked for the state (E05-S08). */
function syncInstallation(sync: NonNullable<HandlerDeps['syncInstallation']>): JobHandler<'sync-installation'> {
  return async (job, { signal }) => ({ outcome: (await sync(job.githubInstallationId, signal)).status });
}

/**
 * Binds the handlers of the delivery-driven jobs (`evaluate-pr`, `evaluate-head-sha`, `close-pr`, `recheck-comment`,
 * `sync-installation`) and of the two the scheduler starts (`sweep`, `sweep-installation`). The ones whose story is not
 * built yet fail their jobs (see {@link HandlerUnavailableError}) instead of completing them.
 * @throws HandlerRegisteredError when a type already has a handler.
 */
export function registerHandlers(registry: HandlerRegistry, deps: HandlerDeps): void {
  registry.register(
    'sync-installation',
    deps.syncInstallation === undefined
      ? unavailable('sync-installation', 'no GitHub App is configured')
      : syncInstallation(deps.syncInstallation),
  );
  registry.register('evaluate-pr', unavailable('evaluate-pr', 'its handler is built by E07-S04'));
  registry.register('evaluate-head-sha', unavailable('evaluate-head-sha', 'its handler is built by E07-S07'));
  registry.register('close-pr', unavailable('close-pr', 'its handler is built by E07-S06'));
  registry.register('recheck-comment', unavailable('recheck-comment', 'its handler is built by E07-S07'));
  registry.register('sweep', unavailable('sweep', 'its handler is built by E07-S08'));
  registry.register('sweep-installation', unavailable('sweep-installation', 'its handler is built by E07-S08'));
}
