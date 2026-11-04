// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { appendAudit } from './audit.ts';
import type { RevokeReason, SignatureToRevoke } from './signature-revoke-queries.ts';

// The audit row of a revocation (E15-S03), split from signature-revoke.ts, which keeps the rules of the revocation itself.

/**
 * Appends `signature.revoked` in the transaction `trx`: the signature as the subject, and as metadata the ids that say what was
 * revoked (the document, the version, its major, the signer by numeric GitHub id) and the reason code. A name, an email or a login
 * never goes into the audit log.
 * @param trx the transaction of the revocation.
 * @param scope the tenant.
 * @param by who revoked and why: the numeric GitHub id of the actor and the reason code.
 * @param by.actorGithubId the person who revoked.
 * @param by.reason the reason code of the revocation.
 * @param signature the signature that was revoked.
 */
export async function auditRevocation(
  trx: Transaction<Database>,
  scope: TenantScope,
  by: { readonly actorGithubId: GithubId; readonly reason: RevokeReason },
  signature: SignatureToRevoke,
): Promise<void> {
  await appendAudit(trx, {
    action: 'signature.revoked',
    installationId: scope.installationId,
    actorGithubId: by.actorGithubId,
    subject: { type: 'signature', id: signature.id },
    metadata: {
      document_id: signature.documentId,
      version_id: signature.versionId,
      major: signature.major,
      user_github_id: signature.signerGithubId,
      reason_code: by.reason,
    },
  });
}
