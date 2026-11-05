// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { enqueueAffectedPrs } from './affected-prs.ts';
import { appendAudit } from './audit.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { insertCommitOverride } from './commit-override-queries.ts';
import {
  type CleanedOverride,
  type NewCommitOverride,
  type RecordedCommitOverride,
  requireEnabled,
} from './commit-override-request.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { lockRepositoryForDocumentChange } from './repository-document-lock-queries.ts';
import { requireActionRole } from './repository-enablement-checks.ts';

// The transaction of recording a per-commit override (E15-S05): the part of commit-override-create.ts that writes.

/**
 * Everything recording the override does in the transaction `trx`: the repository locked and judged again (the lock of the CLA change
 * and of the enforcement switch, so the role is judged against the document the repository enforces at that moment and a repository
 * that was switched off meanwhile takes nothing), the row, the audit row and the jobs.
 * @throws ClaRuleError `not_found`, `forbidden`, `repository_disabled`, `override_exists`; whatever the enqueuer rejects with.
 */
export async function recordOverride(
  trx: Transaction<Database>,
  context: { readonly scope: TenantScope; readonly enqueuer: JobEnqueuer },
  request: NewCommitOverride & CleanedOverride,
): Promise<RecordedCommitOverride> {
  const { scope, enqueuer } = context;
  const repository = await lockRepositoryForDocumentChange(trx, scope, request.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  requireActionRole(request.role, repository);
  requireEnabled(repository);
  const stored = await insertCommitOverride(trx, scope, {
    repositoryId: repository.id,
    commitSha: request.commitSha,
    reason: request.reason,
    createdBy: request.actor.id,
  });
  if (stored === undefined) {
    throw new ClaRuleError('override_exists');
  }
  await appendAudit(trx, {
    action: 'commit_override.created',
    installationId: scope.installationId,
    actorGithubId: request.actor.githubId,
    subject: { type: 'commit_override', id: stored.id },
    metadata: { repository_id: repository.id, commit_sha: request.commitSha },
  });
  await enqueueAffectedPrs(trx, enqueuer, scope, {
    repositoryIds: [repository.id],
    result: 'failure',
    action: { reason: 'override_changed', change: `created:${String(stored.id)}` },
    trigger: 'policy_change',
  });
  return {
    id: stored.id,
    repositoryId: repository.id,
    commitSha: request.commitSha,
    reason: request.reason,
    createdBy: { githubId: request.actor.githubId, login: request.actor.login },
    createdAt: stored.createdAt,
  };
}
