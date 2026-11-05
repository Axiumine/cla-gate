// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { JobType } from '../domain/job-envelope.ts';
import type { EvaluatePrPorts } from './evaluate-pr/evaluate-pr-ports.ts';
import {
  closePrHandler,
  evaluateHeadShaHandler,
  evaluatePrHandler,
  recheckCommentHandler,
} from './evaluation-handlers.ts';
import { finaliseCheckHandler, finaliseRepositoryHandler } from './finalise/finalise-handlers.ts';
import type { SyncOutcome } from './installation-sync-model.ts';
import type { HandlerRegistry, JobHandler } from './job-registry.ts';
import { retentionSweepHandler } from './retention/retention-handler.ts';
import type { RetentionDeps } from './retention/retention-sweep.ts';
import type { SweepDeps } from './sweep/sweep.ts';
import { sweepHandler, sweepInstallationHandler, sweepRepositoryHandler } from './sweep/sweep-handlers.ts';

// The handlers the job queue binds (E07-S03). `registerHandlers` is the one list of what runs which job: a story that
// builds a handler replaces its line here. `revoke-user-sessions` is not in it, its consumer comes with E10-S07, which
// registers it through the registry from its own code; until then its queue keeps the jobs. The two jobs that follow turning
// enforcement off (`finalise-repository`, `finalise-check`, E07-S09) are bound here since E14-S04.

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
  /**
   * What the `evaluate-pr` job runs on, for one job (E07-S04), and the `close-pr` job (E07-S06), the two jobs of the manual
   * re-evaluation, `recheck-comment` and `evaluate-head-sha` (E07-S07), and the `sweep-repository` job (E07-S09) as well
   * (they use the part of it that is not the engine), and the two `finalise-*` jobs (E14-S04): its GitHub client is bound to the
   * `signal` of the job, so a job that is being shut down does not hold the process on a request. Undefined when the application has no GitHub App or no reporter (the reporter
   * is E09): the handlers then fail every job and keep its delivery for a redelivery.
   */
  readonly evaluatePr: ((signal: AbortSignal) => EvaluatePrPorts) | undefined;
  /**
   * What the `sweep` job needs (E07-S08): the database and the reconciliation of the installations. Undefined (or left out)
   * when no GitHub App is configured: the job then fails every run. The `sweep-installation` job it starts runs on
   * `evaluatePr`.
   */
  readonly sweep?: SweepDeps | undefined;
  /**
   * What the `retention-sweep` job needs (E22-S04): the database, the clock and the two settings. It needs no GitHub App, so
   * it is given in every mode. Undefined (or left out): the job then fails every run.
   */
  readonly retention?: RetentionDeps | undefined;
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

/** Why a job that runs on the ports of the evaluation fails without them. */
const NO_EVALUATION = 'no GitHub App or no evaluation reporter (E09) is configured';
const NO_APP = 'no GitHub App is configured';

/** What a handler is made of, or why the job fails while there is none. */
interface Needs<N> {
  readonly needs: N | undefined;
  readonly reason: string;
}

/** Binds `type` to the handler `bind` makes of what it needs, or to one that fails its jobs with the reason when that is undefined. */
function bindOrFail<T extends JobType, N>(
  registry: HandlerRegistry,
  type: T,
  { needs, reason }: Needs<N>,
  bind: (needs: N) => JobHandler<T>,
): void {
  registry.register(type, needs === undefined ? unavailable(type, reason) : bind(needs));
}

/** Binds `type` to the handler `bind` makes of the ports of the evaluation, or to one that fails its jobs when there are none. */
function onEvaluationPorts<T extends JobType>(
  registry: HandlerRegistry,
  deps: HandlerDeps,
  type: T,
  bind: (ports: NonNullable<HandlerDeps['evaluatePr']>) => JobHandler<T>,
): void {
  bindOrFail(registry, type, { needs: deps.evaluatePr, reason: NO_EVALUATION }, bind);
}

/**
 * Binds the handlers of the delivery-driven jobs (`evaluate-pr`, `evaluate-head-sha`, `close-pr`, `recheck-comment`,
 * `sync-installation`), of the two the scheduler starts (`sweep`, `sweep-installation`, E07-S08) and of the one a change of
 * policy starts (`sweep-repository`, E07-S09), and of the two that turning enforcement off starts (`finalise-repository` and
 * `finalise-check`, E14-S04), and of the daily purge the scheduler starts (`retention-sweep`, E22-S04). The ones whose
 * consumer is not available fail their jobs (see {@link HandlerUnavailableError}) instead of completing them.
 * @throws HandlerRegisteredError when a type already has a handler.
 */
export function registerHandlers(registry: HandlerRegistry, deps: HandlerDeps): void {
  bindOrFail(registry, 'sync-installation', { needs: deps.syncInstallation, reason: NO_APP }, syncInstallation);
  onEvaluationPorts(registry, deps, 'evaluate-pr', evaluatePrHandler);
  onEvaluationPorts(registry, deps, 'evaluate-head-sha', evaluateHeadShaHandler);
  onEvaluationPorts(registry, deps, 'close-pr', closePrHandler);
  onEvaluationPorts(registry, deps, 'recheck-comment', recheckCommentHandler);
  bindOrFail(registry, 'sweep', { needs: deps.sweep, reason: NO_APP }, sweepHandler);
  onEvaluationPorts(registry, deps, 'sweep-installation', sweepInstallationHandler);
  onEvaluationPorts(registry, deps, 'sweep-repository', sweepRepositoryHandler);
  onEvaluationPorts(registry, deps, 'finalise-repository', finaliseRepositoryHandler);
  onEvaluationPorts(registry, deps, 'finalise-check', finaliseCheckHandler);
  bindOrFail(
    registry,
    'retention-sweep',
    { needs: deps.retention, reason: 'the retention settings are not wired' },
    retentionSweepHandler,
  );
}
