// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { lockRepositoryForDocumentChange } from './repository-document-lock-queries.ts';
import { setRepositoryEnabled } from './repository-enabled.ts';
import { requireActionRole } from './repository-enablement-checks.ts';
import type { Switch, Switched } from './repository-switch-types.ts';

// The one transaction behind the switch of enforcement of a repository, on (E14-S03) or off (E14-S04): under the lock of the
// repository row, the role is judged by the repository-action rule on the document read under that lock, the direction adds its
// own check, `setRepositoryEnabled` (E05-S06) moves the flag and writes the audit row, and the job the direction sends goes into the
// same transaction, so the change and the job commit or roll back together. The lock is the one the change of the CLA document takes
// (E14-S02), so a detach cannot slip in between the check that a CLA is attached and the flag that turns it on, and a disable
// cannot be interleaved with an enable. This module adds no update and no audit insert of its own.

/**
 * Everything a switch does in the transaction `trx`: the checks, then the change and the job.
 * @throws ClaRuleError a rule the call breaks; whatever the enqueuer rejects with.
 */
async function switchWithin(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  request: Switch,
): Promise<Switched> {
  const { direction } = request;
  const repository = await lockRepositoryForDocumentChange(trx, scope, request.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  requireActionRole(request.role, repository);
  direction.require(repository);
  const { changed } = await setRepositoryEnabled(trx, {
    installationId: scope.installationId,
    githubRepoId: repository.githubRepoId,
    enabled: direction.enabled,
    actorGithubId: request.actorGithubId,
  });
  if (changed) {
    await direction.send(trx, scope, enqueuer, repository);
  }
  return { enabled: direction.enabled, changed };
}

/**
 * Switches enforcement of a repository of the tenant the way the direction of `request` says, in one transaction under the lock of the repository
 * row: the flag moves, `setRepositoryEnabled` appends the audit row (ids only) and the job of the direction is sent. A call that
 * finds the flag at that value already (the second of two simultaneous ones, say) changes, audits and sends nothing. The role is
 * judged first and only then the direction's own check, so the role decides what a person learns. A failure at any step, a
 * throwing enqueuer included, rolls everything back, and a retry then succeeds. No call is made to GitHub.
 * @throws ClaRuleError `not_found` (the repository left the tenant since the guard read it), `forbidden` (the role is too low for
 * the document the repository enforces) and whatever the direction's check throws. Anything the enqueuer rejects with.
 */
export function switchRepository(
  db: Kysely<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  request: Switch,
): Promise<Switched> {
  return db.transaction().execute((trx) => switchWithin(trx, scope, enqueuer, request));
}
