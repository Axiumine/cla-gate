// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { reevaluateAfterRevocation } from './signature-reevaluate.ts';
import { auditRevocation } from './signature-revoke-audit.ts';
import { findSignatureToRevoke, markSignatureRevoked, type RevokeReason } from './signature-revoke-queries.ts';

// Revoking a signature (E15-S03): one transaction sets the three revocation columns, appends the audit row and sends the jobs that
// evaluate the pull requests the signature covered again, all or nothing. Revocation is prospective: the signature stops covering the
// evaluations from now on, the contributions already accepted stay licensed, and nothing rewrites a Check Run that is not evaluated
// again. There is no way back (a trigger refuses it, and nothing here tries): a person who should be covered again signs again.

/** What the services need of the world: the database and the queue the jobs are sent to. */
export interface RevokeDeps {
  readonly db: Kysely<Database>;
  readonly enqueuer: JobEnqueuer;
}

/** The request: the signature of the tenant, the reason code, and the person who revokes (`users.id` for the foreign key, the GitHub id for the audit row). */
export interface SignatureRevocation {
  readonly signatureId: number;
  readonly reason: RevokeReason;
  readonly actor: { readonly userId: number; readonly githubId: GithubId };
}

/** What a revocation came to: the signature, the instant the database stamped, and how many jobs were asked for. */
export interface RevokedSignature {
  readonly id: number;
  readonly revokedAt: Date;
  readonly reevaluating: number;
}

/**
 * Everything a revocation does in the transaction `trx`: the signature is read with the installation id, the three columns are set
 * only while it is not revoked (so of two simultaneous revocations one changes the row and the other, which waits for it, finds it
 * revoked), the audit row is appended and the jobs are sent.
 * @throws ClaRuleError `not_found`, `already_revoked`; whatever the enqueuer rejects with.
 */
async function revokeWithin(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  revocation: SignatureRevocation,
): Promise<RevokedSignature> {
  const signature = await findSignatureToRevoke(trx, scope, revocation.signatureId);
  if (signature === undefined) {
    throw new ClaRuleError('not_found');
  }
  const revokedAt = await markSignatureRevoked(trx, scope, {
    signatureId: signature.id,
    revokedBy: revocation.actor.userId,
    reason: revocation.reason,
  });
  if (revokedAt === null) {
    throw new ClaRuleError('already_revoked');
  }
  await auditRevocation(trx, scope, { actorGithubId: revocation.actor.githubId, reason: revocation.reason }, signature);
  return {
    id: signature.id,
    revokedAt,
    reevaluating: await reevaluateAfterRevocation(trx, enqueuer, scope, signature),
  };
}

/**
 * Revokes a signature of the tenant: the revocation columns are set, `signature.revoked` is appended (ids and the reason code, no
 * name), and one `evaluate-pr` job is sent for each open pull request that relied on the signature, or above 100 of them one
 * `sweep-repository` job for each repository. A failure at any step, a throwing enqueuer included, rolls everything back and the
 * signature stays as it was.
 * @throws ClaRuleError `not_found` (the tenant has no such signature), `already_revoked`. Anything the enqueuer rejects with.
 */
export async function revokeSignature(
  deps: RevokeDeps,
  scope: TenantScope,
  revocation: SignatureRevocation,
): Promise<RevokedSignature> {
  return deps.db.transaction().execute((trx) => revokeWithin(trx, deps.enqueuer, scope, revocation));
}
