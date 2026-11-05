// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { type CommitGitHub, requireCommit } from './commit-override-lookup.ts';
import { recordOverride } from './commit-override-record.ts';
import {
  cleaned,
  type NewCommitOverride,
  type RecordedCommitOverride,
  requireEnabled,
} from './commit-override-request.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { findRepositoryWithDocument } from './repository-document-lock-queries.ts';
import { requireActionRole } from './repository-enablement-checks.ts';

// Recording a per-commit override (E15-S05): the documented escape hatch for a commit whose author or committer email GitHub cannot link
// to an account. The override waives the check for that commit's unlinked identities and nothing else: it is not a signature (no row of
// `signatures` or `signer_pii` is written), so the pull request opener and every other commit still have to be covered by the engine
// (E08). The role and the repository are judged first, then the request is cleaned, then GitHub is asked whether the repository has the
// commit (outside any transaction, so no connection waits on it), and one transaction (commit-override-record.ts) stores the override,
// appends the audit row `commit_override.created` (ids and the SHA only, never the reason, which is free text) and sends the jobs that
// evaluate again the open pull requests of the repository that fail, all or nothing.

/** What the service works with: the database, GitHub for the lookup of the commit and the queue for the re-evaluation. */
export interface CommitOverrideDeps {
  readonly db: Kysely<Database>;
  readonly github: CommitGitHub;
  readonly enqueuer: JobEnqueuer;
}

/**
 * Records an override of a commit of a repository of the tenant. The role is judged first, so a person without it learns nothing from
 * GitHub, then the request is cleaned and GitHub is asked whether the repository has the commit. One transaction then stores the
 * override with its author and the instant the database stamped, appends `commit_override.created` and sends one `evaluate-pr` job
 * for each open pull request of the repository whose latest result is a failure, or above 100 of them one `sweep-repository` job
 * (reason `override_changed`). A failure at any step, a throwing enqueuer included, rolls everything back and nothing is stored.
 * @throws ClaRuleError `not_found`, `forbidden`, `invalid_commit_sha`, `invalid_reason`, `repository_disabled`, `commit_not_found`,
 * `override_exists`; GitHubRateLimitedError and GitHubUnavailableError for a lookup GitHub did not answer. Anything the enqueuer
 * rejects with.
 */
export async function createCommitOverride(
  deps: CommitOverrideDeps,
  scope: TenantScope,
  request: NewCommitOverride,
): Promise<RecordedCommitOverride> {
  const { db, github, enqueuer } = deps;
  const repository = await findRepositoryWithDocument(db, scope, request.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  requireActionRole(request.role, repository);
  const clean = cleaned(request);
  requireEnabled(repository);
  await requireCommit(github, {
    githubInstallationId: repository.githubInstallationId,
    fullName: repository.fullName,
    sha: clean.commitSha,
  });
  return db.transaction().execute((trx) => recordOverride(trx, { scope, enqueuer }, { ...request, ...clean }));
}
