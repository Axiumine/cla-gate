// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from './adapters/db/schema.ts';
import type { WorkerWiring } from './adapters/jobs/workers.ts';
import type { InstallationWiring } from './boot-installations.ts';
import type { AppConfig } from './config/env.ts';
import { evaluatePullRequest } from './domain/evaluation/index.ts';
import { registerHandlers } from './services/job-handlers.ts';
import { HandlerRegistry } from './services/job-registry.ts';
import { createOrgMembership } from './services/org-membership.ts';
import { type Clock, systemClock } from './services/ports/clock.ts';
import type { GitHubClient } from './services/ports/github.ts';
import type { EvaluationReporter } from './services/ports/reporter.ts';
import { markDeliveryProcessed } from './services/webhook-delivery-rows.ts';

// What the job workers need, wired at boot (E07-S03): the handlers, the delivery a finished job marks processed, the time
// and how many jobs run at once. This is the one place where handlers are bound. An epic that owns a job registers its
// handler here, with `registry.register(type, handler)` after `registerHandlers` (E10-S07 does so for
// `revoke-user-sessions`); no file of the queue, the wrapper or the other handlers changes.

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
}

/** The handlers of the application, in a registry, and what runs them. */
export function jobWorkers(options: JobWorkersOptions): WorkerWiring {
  const { db, config, logger, syncFor, evaluation } = options;
  const clock = options.clock ?? systemClock;
  const registry = new HandlerRegistry();
  registerHandlers(registry, {
    syncInstallation:
      syncFor === undefined
        ? undefined
        : (githubInstallationId, signal) => syncFor(signal).syncInstallation(githubInstallationId),
    evaluatePr:
      evaluation === undefined
        ? undefined
        : (signal) => {
            const github = evaluation.github.withSignal(signal);
            return {
              db,
              github,
              clock,
              orgMembership: createOrgMembership({ db, github, logger }),
              reporter: evaluation.reporter,
              evaluate: evaluatePullRequest,
            };
          },
  });
  return {
    registry,
    markDeliveryProcessed: (deliveryId) => markDeliveryProcessed(db, deliveryId),
    clock,
    concurrency: config.workerConcurrency,
  };
}
