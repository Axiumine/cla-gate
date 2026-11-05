// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql, type Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { signatureBasisNeedles } from '../domain/affected-prs.ts';
import { enqueueAffectedPrs } from './affected-prs.ts';
import { listEnforcingRepositories } from './cla-enforcing-queries.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import type { SignatureToRevoke } from './signature-revoke-queries.ts';

// The pull requests a revoked signature can change (E15-S03), in the transaction of the revocation: split from signature-revoke.ts,
// which keeps the rules of the revocation itself.

/**
 * Sends the jobs that evaluate again the open pull requests the signature covered: of the repositories that enforce its document, those
 * whose latest result is a success that names the signature, or its signer as covered by a signature, in the stored details of E08.
 * The signer's other signatures are not looked at: the evaluation reads the signatures that are not revoked when it runs, so a
 * signer who is covered by another one stays covered.
 */
export async function reevaluateAfterRevocation(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  signature: SignatureToRevoke,
): Promise<number> {
  const repositories = await listEnforcingRepositories(trx, scope, signature.documentId);
  const needles = signatureBasisNeedles(signature.id, signature.signerGithubId);
  return enqueueAffectedPrs(trx, enqueuer, scope, {
    repositoryIds: repositories.map((repository) => repository.repositoryId),
    result: 'success',
    detailsMatch: (details) => sql<boolean>`(${details} @> ${needles[0]}::jsonb or ${details} @> ${needles[1]}::jsonb)`,
    action: { reason: 'signature_revoked', change: String(signature.id) },
    trigger: 'signature',
  });
}
