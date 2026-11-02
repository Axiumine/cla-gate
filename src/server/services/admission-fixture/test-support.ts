// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import { captureLogs, type LogCapture } from '../../test-support.ts';
import { type AdmissionPolicies, createAdmissionPolicies } from '../admission-policies.ts';
import { createInstallationAdmission, type InstallationAdmission } from '../installation-admission.ts';
import { createInstallationStore, type InstallationStore } from '../installation-store.ts';
import type { GitHubInstallation } from '../ports/github.ts';
import { FakeClock } from '../test-support.ts';

// The admission service on a migrated database with a clock, a captured log and an owner account (E05-S07).

const id = parseGithubId;

/** The account that owns the App in these tests. */
export const OWNER: GithubId = id(9001);

export const START = '2026-11-02T10:00:00.000Z';

/** An installation as GitHub describes it: installation id `githubId`, an organisation (or a user) with `accountId`. */
export function githubInstallation(
  githubId: number,
  accountId: number,
  overrides: { type?: 'Organization' | 'User'; login?: string; suspendedAt?: Date | null } = {},
): GitHubInstallation {
  return {
    id: id(githubId),
    account: {
      id: id(accountId),
      login: overrides.login ?? `account-${accountId}`,
      type: overrides.type ?? 'Organization',
    },
    suspendedAt: overrides.suspendedAt ?? null,
    permissions: { checks: 'write', metadata: 'read' },
  };
}

export interface AdmissionWorld {
  readonly db: Kysely<Database>;
  readonly store: InstallationStore;
  readonly clock: FakeClock;
  readonly logs: LogCapture;
  readonly logger: Logger;
  /** The service with a policy source of the test's own making (one that fails, say). */
  readonly admissionWith: (policies: AdmissionPolicies) => InstallationAdmission;
  /** The service for a policy of these configured ids (the owner is always added). Several share one database. */
  readonly admissionFor: (configured: readonly number[]) => InstallationAdmission;
}

export async function admissionWorld(): Promise<AdmissionWorld> {
  const { db } = await migratedTestDatabase();
  const clock = new FakeClock(START);
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  const admissionWith = (policies: AdmissionPolicies) => createInstallationAdmission({ db, clock, logger, policies });
  return {
    db,
    store: createInstallationStore(db),
    clock,
    logs,
    logger,
    admissionWith,
    admissionFor: (configured) =>
      admissionWith(
        createAdmissionPolicies({
          configured: configured.map((account) => id(account)),
          ownerAccountId: () => Promise.resolve(OWNER),
          logger,
        }),
      ),
  };
}

/** Every audit row, oldest first. */
export async function auditRows(db: Kysely<Database>) {
  return await db
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'action', 'subject_type', 'subject_id', 'metadata'])
    .orderBy('id')
    .execute();
}
