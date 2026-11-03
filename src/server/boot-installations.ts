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
import { createOperatorPolicies, type OperatorPolicies } from './services/operator-policies.ts';
import { type Clock, systemClock } from './services/ports/clock.ts';
import type { GitHubClient } from './services/ports/github.ts';

// What the start-up wires between the GitHub App and the database once both are open (E05-S07): the stored gate that
// the installation token provider asks, the admission policy with the App owner's account in it and, on top of both,
// the installation sync (E05-S08), and the policy of the instance operators (E11-S08), which reads the same owner.

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
  /**
   * The same sync for one job (E07-S03): its GitHub requests are cancelled when `signal` aborts, so a job that is being
   * shut down does not hold the process on a request. Undefined without a GitHub App.
   */
  readonly syncFor: ((signal: AbortSignal) => InstallationSync) | undefined;
  /** Who operates the instance (E11-S08): `OPERATOR_GITHUB_IDS`, else the App owner when it is a user; the application guards the operator routes with it. */
  readonly operators: OperatorPolicies;
}

/**
 * Builds the operator policy (E11-S08) and logs the effective ids at once, unless the owner of the App decides and the
 * self-check has not succeeded yet (an outage): then it warns, and the first use logs the ids once the check is repeated.
 */
async function wireOperators(options: {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly app: GitHubApp | undefined;
}): Promise<OperatorPolicies> {
  const { config, logger, app } = options;
  const configured = config.github.operatorGithubIds;
  const operators = createOperatorPolicies({
    configured,
    owner:
      app === undefined
        ? undefined
        : async () => {
            const { ownerId, ownerType } = await app.identity.verify();
            return { id: ownerId, type: ownerType };
          },
    logger,
  });
  if (configured === undefined && app !== undefined && app.identity.current() === undefined) {
    logger.warn('github.operator_policy_pending');
  } else {
    await operators.current();
  }
  return operators;
}

/**
 * Binds the gate to the stored installations and builds the admission service. The effective policy (the configured ids
 * plus the App owner) is logged here as `github.admission_policy`. When an outage skipped the self-check, the owner is
 * not known yet: the line says so (`github.admission_policy_pending`, with the configured ids) and the effective policy
 * is logged by the first use, once the check has been repeated. The operator policy (E11-S08) is logged the same way as
 * `github.operator_policy` and `github.operator_policy_pending`; with `OPERATOR_GITHUB_IDS` set, or without a GitHub App,
 * GitHub is not needed and the line is logged at once.
 */
export async function wireInstallations(options: InstallationWiringOptions): Promise<InstallationWiring> {
  const { db, config, logger, gate, app } = options;
  const clock = options.clock ?? systemClock;
  const installations = createInstallationStore(db);
  const operators = await wireOperators({ config, logger, app });
  if (app === undefined) {
    return { installations, admission: undefined, sync: undefined, syncFor: undefined, operators };
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
  gate.bind(
    createStoredGate(
      (githubInstallationId) => installations.findInstallationByGithubId(githubInstallationId),
      policies,
    ),
  );
  const admission = createInstallationAdmission({ db, policies, clock, logger });
  const syncWith = (github: GitHubClient): InstallationSync =>
    createInstallationSync({ db, github, admission, clock, logger });
  return {
    installations,
    admission,
    sync: syncWith(app.client),
    syncFor: (signal) => syncWith(app.client.withSignal(signal)),
    operators,
  };
}
