// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { appendAudit } from './audit.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { deleteCommitOverride } from './commit-override-queries.ts';
import { reevaluateAfterRemoval } from './commit-override-reevaluate.ts';
import type { CommitOverrideRemovalDeps, OverrideRemoval } from './commit-override-remove-request.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { lockRepositoryForDocumentChange } from './repository-document-lock-queries.ts';
import { requireActionRole } from './repository-enablement-checks.ts';

// Removing a per-commit override (E15-S06): the withdrawal of one that was a mistake. One transaction locks the repository and judges the
// role against the document it enforces then, deletes the row for good, appends the audit row `commit_override.deleted` (ids and the
// SHA only, never the reason, which is free text) and sends the jobs that evaluate again the pull requests the override had turned
// green, all or nothing: taking a waiver away can turn a green check red. The history of a removed override is that audit row and the
// `commit_override.created` row of the record; the table holds the overrides that are in force, so the commit can be overridden again.

/**
 * Everything the removal does in the transaction `trx`: the repository locked and its role judged (the lock of the CLA change and of the
 * enforcement switch, so the role is judged against the document the repository enforces at that moment), the delete, the audit row
 * and the jobs.
 * @throws ClaRuleError `not_found`, `forbidden`; whatever the enqueuer rejects with.
 */
async function removeWithin(
  trx: Transaction<Database>,
  context: { readonly scope: TenantScope; readonly enqueuer: JobEnqueuer },
  request: OverrideRemoval,
): Promise<void> {
  const { scope, enqueuer } = context;
  const repository = await lockRepositoryForDocumentChange(trx, scope, request.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  requireActionRole(request.role, repository);
  const removed = await deleteCommitOverride(trx, scope, {
    repositoryId: repository.id,
    overrideId: request.overrideId,
  });
  if (removed === undefined) {
    throw new ClaRuleError('not_found');
  }
  await appendAudit(trx, {
    action: 'commit_override.deleted',
    installationId: scope.installationId,
    actorGithubId: request.actorGithubId,
    subject: { type: 'commit_override', id: request.overrideId },
    metadata: { repository_id: repository.id, commit_sha: removed.commitSha },
  });
  await reevaluateAfterRemoval(trx, enqueuer, scope, {
    repositoryId: repository.id,
    overrideId: request.overrideId,
    commitSha: removed.commitSha,
  });
}

/**
 * Removes an override of a repository of the tenant: the row is deleted, `commit_override.deleted` is appended and one `evaluate-pr` job
 * is sent for each open pull request of the repository whose latest result is a success and whose stored details list the commit with an
 * override, or above 100 of them one `sweep-repository` job (reason `override_changed`). The role is the one that records an override.
 * An override the repository does not have (another tenant's, another repository's, unknown, or removed already, also by a simultaneous
 * call) is `not_found`. A failure at any step, a throwing enqueuer included, rolls everything back and the override stays.
 * @throws ClaRuleError `not_found`, `forbidden`. Anything the enqueuer rejects with.
 */
export async function removeCommitOverride(
  deps: CommitOverrideRemovalDeps,
  scope: TenantScope,
  request: OverrideRemoval,
): Promise<void> {
  const { db, enqueuer } = deps;
  await db.transaction().execute((trx) => removeWithin(trx, { scope, enqueuer }, request));
}
