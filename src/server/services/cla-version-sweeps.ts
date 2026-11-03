// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { listEnforcingRepositories } from './cla-enforcing-queries.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The re-evaluation a new major version asks for (E12-S04). Pull requests that were green under the old major may be red under
// the new one, so every repository that enforces the document gets one `sweep-repository` job, sent on the connection of the
// publishing transaction: the version and its jobs commit or roll back together. The sweep itself (listing the open pull
// requests and evaluating them) is E07-S09's. The job is E07-S09's too: until it lands in this tree the envelope is the
// member of the job catalogue (`domain/jobs.ts`), and the options below are what the port takes.

/** The version that was just published and the document it belongs to. */
export interface PublishedRef {
  readonly documentId: number;
  readonly versionId: number;
}

/**
 * Sends a `sweep-repository` job with the reason `cla_version_published` for each repository of the tenant that enforces the
 * document: attached to it, enabled and not removed. The send is keyed by the version and the repository, so a retry of the
 * same publish sends nothing twice, and a later version sends again. No time window is used: a second publish a few seconds
 * after the first must still be swept, because a run that has started has read the policy of the first.
 * @throws Error whatever the enqueuer rejects with; the caller's transaction is rolled back, and so is the publish.
 */
export async function enqueueVersionSweeps(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  published: PublishedRef,
): Promise<void> {
  for (const repository of await listEnforcingRepositories(trx, scope, published.documentId)) {
    await enqueuer.enqueue(
      trx,
      { type: 'sweep-repository', ...repository, reason: 'cla_version_published' },
      { idempotencyKey: `sweep-repository:cla_version_published:${published.versionId}:${repository.githubRepoId}` },
    );
  }
}
