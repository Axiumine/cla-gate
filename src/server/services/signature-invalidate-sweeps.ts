// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { affectedSweepKey } from '../domain/affected-prs.ts';
import { listEnforcingRepositories } from './cla-enforcing-queries.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { enqueueSweepRepository } from './repository-job-enqueue.ts';
import type { MajorOfDocument } from './signature-invalidate-queries.ts';

/**
 * Sends a `sweep-repository` job with the reason `signatures_invalidated` to each repository of the tenant that enforces the document:
 * attached to it, enabled and not removed. The key names the action by the document, the major and the instant of its transaction, so
 * a later invalidation of the same major (after people signed again) sends again, and the coalescing of the sweep per repository
 * (E07-S09) lets a run that still waits cover both (E15-S04).
 * @throws Error whatever the enqueuer rejects with; the caller's transaction is rolled back, and the invalidation with it.
 */
export async function sendInvalidationSweeps(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  invalidation: MajorOfDocument & { readonly revokedAt: Date },
): Promise<void> {
  const change = `${invalidation.documentId}:${invalidation.major}:${invalidation.revokedAt.getTime()}`;
  for (const repository of await listEnforcingRepositories(trx, scope, invalidation.documentId)) {
    await enqueueSweepRepository(trx, enqueuer, {
      ...repository,
      reason: 'signatures_invalidated',
      idempotencyKey: affectedSweepKey({ reason: 'signatures_invalidated', change }, repository.githubRepoId),
    });
  }
}
