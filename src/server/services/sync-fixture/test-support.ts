// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { type AdmissionWorld, admissionWorld, auditRows, OWNER } from '../admission-fixture/test-support.ts';
import type { InstallationAdmission } from '../installation-admission.ts';
import { createStoredGate } from '../installation-gate.ts';
import { findInstallationByGithubId } from '../installation-queries.ts';
import { createInstallationSync, type InstallationSync } from '../installation-sync.ts';
import type { GitHubInstallation, GitHubRepository } from '../ports/github.ts';
import { FakeGitHub } from '../test-support.ts';

// The installation sync on a migrated database, a scripted GitHub and a captured log (E05-S08). The fake sits behind the
// stored gate, as in production: a repository listing is refused unless the installation row says admitted and active.

export { auditRows, OWNER };

const id = parseGithubId;

/** The permissions the platform needs (docs/github-app.md), so a test that is not about permissions logs no warning. */
const ENOUGH_PERMISSIONS = {
  metadata: 'read',
  pull_requests: 'write',
  checks: 'write',
  issues: 'read',
  members: 'read',
};

/** An installation as GitHub describes it; `accountId` is the account that installed the App (the owner is 9001). */
export function remoteInstallation(
  githubId: number,
  accountId: number,
  overrides: Partial<Omit<GitHubInstallation, 'id' | 'account'>> & {
    login?: string;
    type?: 'Organization' | 'User';
  } = {},
): GitHubInstallation {
  return {
    id: id(githubId),
    account: {
      id: id(accountId),
      login: overrides.login ?? `account-${accountId}`,
      type: overrides.type ?? 'Organization',
    },
    suspendedAt: overrides.suspendedAt ?? null,
    permissions: overrides.permissions ?? ENOUGH_PERMISSIONS,
  };
}

/** A repository as GitHub lists it. */
export const remoteRepository = (githubId: number, fullName = `acme/repo-${githubId}`): GitHubRepository => ({
  id: id(githubId),
  fullName,
});

/** `count` repositories with ids from `first`. */
export const remoteRepositories = (first: number, count: number): GitHubRepository[] =>
  Array.from({ length: count }, (_, index) => remoteRepository(first + index));

export interface SyncWorld extends AdmissionWorld {
  readonly fake: FakeGitHub;
  /** The sync under the policy the world was made with: the owner account and the configured ones. */
  readonly sync: InstallationSync;
  /** The sync for a policy of these configured ids (the owner is always added), on the same database and GitHub. */
  readonly syncFor: (configured: readonly number[]) => InstallationSync;
}

export async function syncWorld(configured: readonly number[] = []): Promise<SyncWorld> {
  const world = await admissionWorld();
  const { db, clock, logger } = world;
  const fake = new FakeGitHub({ gate: createStoredGate((githubId) => findInstallationByGithubId(db, githubId)) });
  const syncWith = (admission: InstallationAdmission): InstallationSync =>
    createInstallationSync({ db, github: fake, admission, clock, logger });
  const syncFor = (ids: readonly number[]): InstallationSync => syncWith(world.admissionFor(ids));
  return { ...world, fake, sync: syncFor(configured), syncFor };
}

export const installationRows = (db: Kysely<Database>) =>
  db.selectFrom('installations').selectAll().orderBy('id').execute();

export const repositoryRows = (db: Kysely<Database>) =>
  db.selectFrom('repositories').selectAll().orderBy('installation_id').orderBy('github_repo_id').execute();

/** The surrogate key (`installations.id`) of the installation GitHub knows by this id. */
export async function rowIdOf(db: Kysely<Database>, githubInstallationId: number): Promise<number> {
  const row = await db
    .selectFrom('installations')
    .select('id')
    .where('github_installation_id', '=', githubInstallationId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Every audit action, oldest first. */
export async function auditActions(db: Kysely<Database>): Promise<string[]> {
  return (await auditRows(db)).map((row) => row.action);
}

/** Every table a sync writes, as one value: two equal snapshots mean a run wrote nothing. */
export async function stateOf(db: Kysely<Database>) {
  return {
    installations: await installationRows(db),
    repositories: await repositoryRows(db),
    audit: await db.selectFrom('audit_log').selectAll().orderBy('id').execute(),
  };
}
