// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from './adapters/db/schema.ts';
import type { WorkerWiring } from './adapters/jobs/workers.ts';
import type { InstallationWiring } from './boot-installations.ts';
import type { AppConfig } from './config/env.ts';
import { registerHandlers } from './services/job-handlers.ts';
import { HandlerRegistry } from './services/job-registry.ts';
import { type Clock, systemClock } from './services/ports/clock.ts';
import { markDeliveryProcessed } from './services/webhook-delivery-rows.ts';

// What the job workers need, wired at boot (E07-S03): the handlers, the delivery a finished job marks processed, the time
// and how many jobs run at once. This is the one place where handlers are bound. An epic that owns a job registers its
// handler here, with `registry.register(type, handler)` after `registerHandlers` (E10-S07 does so for
// `revoke-user-sessions`); no file of the queue, the wrapper or the other handlers changes.

export interface JobWorkersOptions {
  readonly db: Kysely<Database>;
  readonly config: AppConfig;
  /** Where the sync of an installation comes from, for the job that calls it. */
  readonly syncFor: InstallationWiring['syncFor'];
  /** Defaults to the wall clock. */
  readonly clock?: Clock | undefined;
}

/** The handlers of the application, in a registry, and what runs them. */
export function jobWorkers(options: JobWorkersOptions): WorkerWiring {
  const { db, config, syncFor } = options;
  const registry = new HandlerRegistry();
  registerHandlers(registry, {
    syncInstallation:
      syncFor === undefined
        ? undefined
        : (githubInstallationId, signal) => syncFor(signal).syncInstallation(githubInstallationId),
  });
  return {
    registry,
    markDeliveryProcessed: (deliveryId) => markDeliveryProcessed(db, deliveryId),
    clock: options.clock ?? systemClock,
    concurrency: config.workerConcurrency,
  };
}
