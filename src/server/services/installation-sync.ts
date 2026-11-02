// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { InstallationAdmission } from './installation-admission.ts';
import { type ReconcileOutcome, reconcileInstallations } from './installation-reconcile.ts';
import type { SyncContext, SyncOutcome } from './installation-sync-model.ts';
import { syncRepositories } from './installation-sync-repositories.ts';
import { syncInstallationState } from './installation-sync-state.ts';
import type { Clock } from './ports/clock.ts';
import type { GitHubClient } from './ports/github.ts';
import { refreshRepositorySnapshot, type SnapshotOutcome } from './repository-refresh.ts';

// Keeps the stored installations and their repositories in line with GitHub (E05-S08). GitHub is the truth: a sync takes
// the installation id and fetches the state itself, so an event payload (E06) is never trusted for anything but the id.
// The job that calls it (E07-S03) and the sweep that reconciles (E07-S08) only decide when.

export interface InstallationSync {
  /**
   * Re-fetches one installation from GitHub and brings the stored state in line with it, in this order.
   * 1. GitHub answers 404: a stored installation is marked deleted with all its repositories (nothing is removed from the
   *    database, so signatures stay) and `installation.deleted` is audited; with no stored row nothing happens.
   * 2. The account snapshot (id, login, type, `suspended_at`) is stored when it differs.
   * 3. The admission policy of E05-S07 decides. A rejected installation ends here: its repositories are not listed and
   *    no installation token is requested.
   * 4. A suspension is audited (`installation.suspended`, `installation.unsuspended`); a suspended installation ends here.
   * 5. An admitted, active installation has its repositories listed and reconciled in one transaction: new ones are
   *    inserted with `enabled = false` (`repository.added`), known ones get the name refreshed (`repository.renamed`
   *    when it changed), removed ones listed again are brought back (`repository.added`) and stored ones that are no
   *    longer listed are marked removed (`repository.removed`). A listed repository that is still active under another
   *    installation of this server was transferred here: that row is first marked removed (`repository.removed`,
   *    `transferred`, under the other tenant) in the same transaction, then this tenant gets its own new row, so the
   *    order in which the two tenants sync does not matter (E05-S09). A listing that fails changes nothing.
   *
   * Idempotent: a second run over unchanged state writes no row and no audit entry. Steps 1 to 4 and step 5 are two
   * transactions, each under the installation's advisory lock, so concurrent runs take turns; the list is fetched
   * between them, with no connection held. A run that fetched an older state can still commit after a newer one; the next
   * run (or the sweep) repairs it.
   * @throws whatever the GitHub client or the database throws; an installation that was suspended or uninstalled between
   * the two steps surfaces as the client's `InstallationSuspendedError` or `InstallationGoneError`, and the next run settles it.
   */
  syncInstallation(githubInstallationId: GithubId): Promise<SyncOutcome>;
  /**
   * Lists the App's installations from GitHub and syncs each one, and syncs every stored, non-deleted installation that
   * GitHub did not list too: `getInstallation` confirms it, and a 404 marks it deleted. Syncing applies the admission
   * policy again, so an account the operator newly allowed becomes admitted and synced, and one no longer allowed becomes
   * rejected with the reason `policy_changed`, each with its audit row. One installation's failure is logged and does
   * not stop the others.
   * @throws when GitHub's list of installations cannot be read (including `pagination_limit`): nothing is inferred then.
   */
  reconcileInstallations(): Promise<ReconcileOutcome>;
  /**
   * Re-fetches one repository of an installation and updates the stored snapshot (E05-S09): a new `full_name` after a
   * rename or a transfer to another owner is stored and audited as `repository.renamed` (ids only, no name), and a 404
   * or 403 from GitHub marks the repository removed (`repository.removed`, `access_lost`). Calling it again changes
   * nothing. The evaluation job (E07-S04) calls it when the name it saw differs from the stored one, and the sweep
   * (E07-S08) for the repositories it re-checks; every sync and reconciliation refreshes all names as well.
   * @throws whatever the GitHub client throws, `InstallationNotAdmittedError` for an installation the instance does not serve included.
   */
  refreshRepositorySnapshot(githubInstallationId: GithubId, githubRepoId: GithubId): Promise<SnapshotOutcome>;
}

export interface InstallationSyncOptions {
  readonly db: Kysely<Database>;
  readonly github: GitHubClient;
  readonly admission: InstallationAdmission;
  readonly clock: Clock;
  readonly logger: Logger;
}

export function createInstallationSync(options: InstallationSyncOptions): InstallationSync {
  const { db, github, logger, clock } = options;
  const ctx: SyncContext = { db, admission: options.admission, clock, logger };
  const syncInstallation: InstallationSync['syncInstallation'] = async (githubInstallationId) => {
    const remote = await github.getInstallation(githubInstallationId);
    const step = await syncInstallationState(ctx, githubInstallationId, remote);
    if (step.repositoriesOf === undefined) {
      return step.outcome;
    }
    const listed = await github.listInstallationRepositories(githubInstallationId);
    const installation = { installationId: step.repositoriesOf, githubInstallationId };
    const repositories = await syncRepositories(ctx, installation, listed);
    return { ...repositories, changed: step.outcome.changed || repositories.changed };
  };
  return {
    syncInstallation,
    reconcileInstallations: () => reconcileInstallations({ db, github, logger, sync: syncInstallation }),
    refreshRepositorySnapshot: (githubInstallationId, githubRepoId) =>
      refreshRepositorySnapshot({ db, github, clock }, githubInstallationId, githubRepoId),
  };
}
