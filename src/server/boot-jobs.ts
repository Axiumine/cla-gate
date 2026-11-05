// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from './adapters/db/schema.ts';
import type { WorkerWiring } from './adapters/jobs/workers.ts';
import type { InstallationWiring } from './boot-installations.ts';
import type { AppConfig } from './config/env.ts';
import { evaluatePullRequest } from './domain/evaluation/index.ts';
import { type HandlerDeps, registerHandlers } from './services/job-handlers.ts';
import { HandlerRegistry } from './services/job-registry.ts';
import { createOrgMembership } from './services/org-membership.ts';
import { createOrgMembershipCache, type OrgMembershipCache } from './services/org-membership-cache.ts';
import { type Clock, systemClock } from './services/ports/clock.ts';
import type { GitHubClient } from './services/ports/github.ts';
import type { EvaluationReporter } from './services/ports/reporter.ts';
import { markDeliveryProcessed } from './services/webhook-delivery-rows.ts';

// What the job workers need, wired at boot (E07-S03): the handlers, the delivery a finished job marks processed, the time
// and how many jobs run at once. This is the one place where handlers are bound. An epic that owns a job registers its
// handler through the `register` option of `jobWorkers`, which runs after `registerHandlers` (E10-S07 does so for
// `revoke-user-sessions`); no file of the queue, the wrapper or the other handlers changes. The dead-letter handlers
// (E07-S05) are bound for every type already, in `services/dead-letter/dead-letter-registry.ts`.

export interface JobWorkersOptions {
  readonly db: Kysely<Database>;
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Where the sync of an installation comes from, for the job that calls it. */
  readonly syncFor: InstallationWiring['syncFor'];
  /**
   * What the `evaluate-pr` job needs from outside (E07-S04): the GitHub client of the App and the reporter that writes the
   * Check Run (E09). Undefined while either is missing: the job then fails its jobs instead of completing them.
   */
  readonly evaluation?: { readonly github: GitHubClient; readonly reporter: EvaluationReporter } | undefined;
  /** Defaults to the wall clock. */
  readonly clock?: Clock | undefined;
  /**
   * Binds handlers besides the ones of this file, once those are in: the epic that owns a job type registers its handler
   * here, from its own composition code (E10-S07 binds `revoke-user-sessions`, E14-S04 the two finalise jobs), so that no
   * file of the queue, the wrapper or the other handlers changes.
   */
  readonly register?: ((registry: HandlerRegistry) => void) | undefined;
}

/** What one `evaluate-pr` run works on, with its GitHub requests bound to the signal of that run; undefined without a GitHub App or a reporter. */
function evaluatePrPorts(
  { db, logger, evaluation }: JobWorkersOptions,
  clock: Clock,
  cache: OrgMembershipCache,
): HandlerDeps['evaluatePr'] {
  if (evaluation === undefined) {
    return undefined;
  }
  return (signal) => {
    const github = evaluation.github.withSignal(signal);
    return {
      db,
      github,
      clock,
      orgMembership: createOrgMembership({ db, github, logger, cache }),
      reporter: evaluation.reporter,
      evaluate: evaluatePullRequest,
    };
  };
}

/** The handlers of the application, in a registry, and what runs them. */
export function jobWorkers(options: JobWorkersOptions): WorkerWiring {
  const { db, config, syncFor, evaluation } = options;
  const clock = options.clock ?? systemClock;
  // One memory of the membership lookup for the whole process: every run builds its own service (its GitHub client is bound
  // to the signal of the run), and they all read and fill this one (E07-S10).
  const membershipCache = createOrgMembershipCache(clock);
  const registry = new HandlerRegistry();
  registerHandlers(registry, {
    syncInstallation:
      syncFor === undefined
        ? undefined
        : (githubInstallationId, signal) => syncFor(signal).syncInstallation(githubInstallationId),
    evaluatePr: evaluatePrPorts(options, clock, membershipCache),
    sweep:
      syncFor === undefined
        ? undefined
        : { db, reconcileInstallations: (signal) => syncFor(signal).reconcileInstallations() },
    // The retention sweep needs the database only (E22-S04), so it runs in every mode, with or without a GitHub App.
    retention: { db, clock, settings: config.retention },
  });
  options.register?.(registry);
  return {
    registry,
    markDeliveryProcessed: (deliveryId) => markDeliveryProcessed(db, deliveryId),
    clock,
    concurrency: config.workerConcurrency,
    // The sweep is scheduled only when both of its jobs can run: the one that fans out needs the sync, the one that sweeps an
    // installation needs the evaluation ports (E07-S08). 0 leaves the scheduler off and removes a schedule a former run set.
    sweepIntervalMinutes: syncFor !== undefined && evaluation !== undefined ? config.sweepIntervalMinutes : 0,
    deadLetter: {
      db,
      evaluation:
        evaluation === undefined
          ? undefined
          : (signal) => ({ github: evaluation.github.withSignal(signal), reporter: evaluation.reporter }),
    },
  };
}
