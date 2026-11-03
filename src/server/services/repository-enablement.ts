// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { Role } from '../domain/authz.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { lockRepositoryForDocumentChange } from './repository-document-lock-queries.ts';
import { setRepositoryEnabled } from './repository-enabled.ts';
import { requireActionRole, requireActiveCla } from './repository-enablement-checks.ts';
import { sendEnableSweep } from './repository-enablement-sweep.ts';

// Turning enforcement on for a repository (E14-S03): one transaction under the lock of the repository row, so the checks, the state
// change and the sweep are decided together and either all happen or none does. The row lock is the one the change of the CLA
// document takes (E14-S02), so a detach cannot slip in between the check that a CLA is attached and the flag that turns it on.
// The state change and its audit row are `setRepositoryEnabled` (E05-S06), conditional on `enabled = false`: of simultaneous
// calls one changes the row and the others find it changed. This module adds no update and no audit insert of its own.

/** One request to turn enforcement on for a repository. */
export interface EnableRequest {
  /** `repositories.id` of the repository, as the tenant guard resolved it. */
  readonly repositoryId: number;
  /** The role the guard let the person in with. */
  readonly role: Role;
  readonly actorGithubId: GithubId;
}

/** The answer: the repository enforces now, and the call is the one that made it. */
export interface Enabled {
  readonly enabled: true;
  readonly changed: boolean;
}

/**
 * Everything an enable does in the transaction `trx`: the checks, then the change and the sweep.
 * @throws ClaRuleError a rule the call breaks; whatever the enqueuer rejects with.
 */
async function enableWithin(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  request: EnableRequest,
): Promise<Enabled> {
  const repository = await lockRepositoryForDocumentChange(trx, scope, request.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  requireActionRole(request.role, repository);
  requireActiveCla(repository);
  const { changed } = await setRepositoryEnabled(trx, {
    installationId: scope.installationId,
    githubRepoId: repository.githubRepoId,
    enabled: true,
    actorGithubId: request.actorGithubId,
  });
  if (!changed) {
    return { enabled: true, changed: false };
  }
  await sendEnableSweep(trx, scope, enqueuer, repository);
  return { enabled: true, changed: true };
}

/**
 * Turns enforcement on for a repository of the tenant: `repositories.enabled` becomes true, the audit row `repository.enabled`
 * (ids only) is appended by `setRepositoryEnabled`, and one `sweep-repository` job with the reason `repository_enabled` is sent so
 * that the pull requests that are already open are evaluated, all in one transaction under the lock of the repository row. A call
 * that finds the repository enabled (the second of two simultaneous ones, say) changes, audits and sends nothing. The role is
 * judged by the repository-action rule on the document read under the lock, and only then is the absence of a CLA to enforce
 * reported, so the role decides what a person learns. A failure at any step, a throwing enqueuer included, rolls everything back,
 * and a retry then succeeds. No call is made to GitHub.
 * @throws ClaRuleError `not_found` (the repository left the tenant since the guard read it), `forbidden` (the role is too low for
 * the document the repository enforces), `no_active_cla`. Anything the enqueuer rejects with.
 */
export function enableRepository(
  db: Kysely<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  request: EnableRequest,
): Promise<Enabled> {
  return db.transaction().execute((trx) => enableWithin(trx, scope, enqueuer, request));
}
