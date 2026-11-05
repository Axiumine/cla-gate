// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql, type Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { agreementBasisNeedle, signatureBasisNeedles } from '../domain/affected-prs.ts';
import { enqueueAffectedPrs } from './affected-prs.ts';
import { listEnforcingRepositories } from './cla-enforcing-queries.ts';
import { findAgreementOfSignature } from './corporate-agreement-of-signature.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import type { SignatureToRevoke } from './signature-revoke-queries.ts';

// The pull requests a revoked signature can change (E15-S03), in the transaction of the revocation: split from signature-revoke.ts,
// which keeps the rules of the revocation itself.

/**
 * Sends the jobs that evaluate again the open pull requests the signature covered: of the repositories that enforce its document, those
 * whose latest result is a success that names the signature, or its signer as covered by a signature, in the stored details of E08. The
 * signer's other signatures are not looked at: the evaluation reads the signatures that are not revoked when it runs, so a signer who is
 * covered by another one stays covered. When the signature is the consent of a corporate agreement (E21-S05) its document is a corporate
 * one, which the repositories enforce as their corporate CLA, and the results that name an approval of the agreement as the basis of an author
 * are asked for too: with the agreement's signature revoked, none of its approvals covers anybody.
 */
export async function reevaluateAfterRevocation(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  signature: SignatureToRevoke,
): Promise<number> {
  const repositories = await listEnforcingRepositories(trx, scope, signature.documentId);
  const agreementId = await findAgreementOfSignature(trx, scope, signature.id);
  const needles = [
    ...signatureBasisNeedles(signature.id, signature.signerGithubId),
    ...(agreementId === null ? [] : [agreementBasisNeedle(agreementId)]),
  ];
  return enqueueAffectedPrs(trx, enqueuer, scope, {
    repositoryIds: repositories.map((repository) => repository.repositoryId),
    result: 'success',
    detailsMatch: (details) =>
      sql<boolean>`(${sql.join(
        needles.map((needle) => sql`${details} @> ${needle}::jsonb`),
        sql` or `,
      )})`,
    action: { reason: 'signature_revoked', change: String(signature.id) },
    trigger: 'signature',
  });
}
