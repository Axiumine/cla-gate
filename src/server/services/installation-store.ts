// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { listInstallationsForOperator, type OperatorInstallation } from './installation-operator.ts';
import { findInstallationByGithubId, upsertInstallation } from './installation-queries.ts';
import type { InstallationRow, InstallationUpsert } from './installation-state.ts';
import { setRepositoryEnabled } from './repository-enabled.ts';
import { findActiveRepositoryByGithubId, markRepositoriesRemoved } from './repository-queries.ts';
import type { RepositoryChanges, RepositoryRow, RepositorySnapshot } from './repository-rows.ts';
import { upsertRepositories } from './repository-upsert.ts';

export type { OperatorInstallation } from './installation-operator.ts';
export type { AdmissionDecision, InstallationRow, InstallationUpsert } from './installation-state.ts';
export { RepositoryNotFoundError } from './repository-enabled.ts';
export type { RepositoryChanges, RepositoryRow, RepositorySnapshot } from './repository-rows.ts';

// The stored state of the installations the instance serves and of their repositories (E05-S06): the one place the
// sync (E05-S08), the evaluation jobs (E07) and the repository settings (E14) read and write it. Every repository
// function takes the installation id and filters by it, so one tenant never reaches the rows of another.

export interface InstallationStore {
  /** Inserts the installation or refreshes its snapshot; see {@link upsertInstallation}. */
  upsertInstallation(input: InstallationUpsert): Promise<InstallationRow>;
  findInstallationByGithubId(githubInstallationId: GithubId): Promise<InstallationRow | null>;
  /** Stores the listed repositories, new ones with `enabled = false`; see {@link upsertRepositories}. */
  upsertRepositories(installationId: number, repositories: readonly RepositorySnapshot[]): Promise<RepositoryChanges>;
  /** Marks active repositories removed, never deletes them; resolves to the ids that changed. */
  markRepositoriesRemoved(
    installationId: number,
    githubRepoIds: readonly GithubId[],
    removedAt: Date,
  ): Promise<GithubId[]>;
  findActiveRepositoryByGithubId(installationId: number, githubRepoId: GithubId): Promise<RepositoryRow | null>;
  /**
   * Every installation with its admission decision and repository counts, for the operator's view (E05-S07). The one
   * read that spans tenants, by design: it returns counts and states, no repository, signature or person.
   */
  listInstallationsForOperator(): Promise<OperatorInstallation[]>;
  /** Turns enforcement on or off and audits the change; see {@link setRepositoryEnabled}. */
  setRepositoryEnabled(
    installationId: number,
    githubRepoId: GithubId,
    enabled: boolean,
    actorGithubId: GithubId,
  ): Promise<{ changed: boolean }>;
}

/**
 * The store over `db`. Pass a transaction to run every call of the store inside it (a call that writes then commits or
 * rolls back with the caller's work); pass the database handle and each call that writes opens its own.
 */
export function createInstallationStore(db: Kysely<Database>): InstallationStore {
  return {
    upsertInstallation: (input) => upsertInstallation(db, input),
    findInstallationByGithubId: (githubInstallationId) => findInstallationByGithubId(db, githubInstallationId),
    upsertRepositories: (installationId, repositories) => upsertRepositories(db, installationId, repositories),
    markRepositoriesRemoved: (installationId, githubRepoIds, removedAt) =>
      markRepositoriesRemoved(db, installationId, githubRepoIds, removedAt),
    findActiveRepositoryByGithubId: (installationId, githubRepoId) =>
      findActiveRepositoryByGithubId(db, installationId, githubRepoId),
    listInstallationsForOperator: () => listInstallationsForOperator(db),
    setRepositoryEnabled: (installationId, githubRepoId, enabled, actorGithubId) =>
      setRepositoryEnabled(db, { installationId, githubRepoId, enabled, actorGithubId }),
  };
}
