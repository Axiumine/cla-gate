// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from './adapters/db/schema.ts';
import type { GitHubApp } from './adapters/github/start.ts';
import type { AppConfig } from './config/env.ts';
import { createAdmissionPolicies } from './services/admission-policies.ts';
import { createInstallationAdmission, type InstallationAdmission } from './services/installation-admission.ts';
import { createStoredGate, type LateBoundGate } from './services/installation-gate.ts';
import { createInstallationStore, type InstallationStore } from './services/installation-store.ts';
import { createInstallationSync, type InstallationSync } from './services/installation-sync.ts';
import { type Clock, systemClock } from './services/ports/clock.ts';

// What the start-up wires between the GitHub App and the database once both are open (E05-S07): the stored gate that
// the installation token provider asks, the admission policy with the App owner's account in it and, on top of both,
// the installation sync (E05-S08).

export interface InstallationWiringOptions {
  readonly db: Kysely<Database>;
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Defaults to the wall clock. */
  readonly clock?: Clock | undefined;
  /** The gate that was handed to the GitHub App at start-up; it refuses every installation until it is bound here. */
  readonly gate: LateBoundGate;
  /** Undefined when the App id or key is not configured: there is no GitHub adapter, so nothing to gate. */
  readonly app: GitHubApp | undefined;
}

export interface InstallationWiring {
  readonly installations: InstallationStore;
  /** Undefined without a GitHub App: the policy needs the owner account the self-check names. */
  readonly admission: InstallationAdmission | undefined;
  /** Keeps the stored installations in line with GitHub (E05-S08); undefined without a GitHub App. */
  readonly sync: InstallationSync | undefined;
}

/**
 * Binds the gate to the stored installations and builds the admission service. The effective policy (the configured ids
 * plus the App owner) is logged here as `github.admission_policy`. When an outage skipped the self-check, the owner is
 * not known yet: the line says so (`github.admission_policy_pending`, with the configured ids) and the effective policy
 * is logged by the first use, once the check has been repeated.
 */
export async function wireInstallations(options: InstallationWiringOptions): Promise<InstallationWiring> {
  const { db, config, logger, gate, app } = options;
  const clock = options.clock ?? systemClock;
  const installations = createInstallationStore(db);
  gate.bind(createStoredGate((githubInstallationId) => installations.findInstallationByGithubId(githubInstallationId)));
  if (app === undefined) {
    return { installations, admission: undefined, sync: undefined };
  }
  const configured = config.github.allowedAccountIds;
  const policies = createAdmissionPolicies({
    configured,
    ownerAccountId: async () => (await app.identity.verify()).ownerId,
    logger,
  });
  if (app.identity.current() === undefined) {
    logger.warn({ accountIds: configured }, 'github.admission_policy_pending');
  } else {
    await policies.current();
  }
  const admission = createInstallationAdmission({ db, policies, clock, logger });
  return {
    installations,
    admission,
    sync: createInstallationSync({ db, github: app.client, admission, clock, logger }),
  };
}
