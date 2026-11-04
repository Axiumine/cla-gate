// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { appendAudit } from './audit.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import type { LockedRepository } from './repository-document-lock-queries.ts';
import { type AttachableDocument, setRepositoryDocument } from './repository-document-queries.ts';
import { enqueueSweepRepository } from './repository-job-enqueue.ts';

// The writes of a change of the CLA a repository enforces (E14-S02), once repository-document-attach.ts has decided that it
// changes something: all in the transaction it is given, so they commit together or not at all.

/** The writes of a change that changes something: the pointer, the audit row and, when the repository is enforcing, the sweep. */
export async function recordChange(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  change: {
    readonly repository: LockedRepository;
    readonly next: AttachableDocument | null;
    readonly actorGithubId: GithubId;
  },
): Promise<void> {
  const { repository, next } = change;
  const changedAt = await setRepositoryDocument(trx, scope, repository.id, next?.id ?? null);
  await appendAudit(trx, {
    action: next === null ? 'repository.cla_document_detached' : 'repository.cla_document_attached',
    installationId: scope.installationId,
    actorGithubId: change.actorGithubId,
    subject: { type: 'repository', id: repository.githubRepoId },
    metadata: {
      repository_id: repository.id,
      document_id: next?.id ?? null,
      previous_document_id: repository.document?.id ?? null,
    },
  });
  if (next !== null && repository.enabled) {
    await enqueueSweepRepository(trx, enqueuer, {
      githubInstallationId: repository.githubInstallationId,
      githubRepoId: repository.githubRepoId,
      reason: 'cla_document_changed',
      idempotencyKey: `sweep-repository:cla_document_changed:${String(repository.githubRepoId)}:${String(changedAt.getTime())}`,
    });
  }
}
