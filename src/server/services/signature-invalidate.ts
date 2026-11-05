// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { appendAudit } from './audit.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { findDocumentPlacement } from './document-placement.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { invalidateActiveSignatures, type MajorOfDocument } from './signature-invalidate-queries.ts';
import { sendInvalidationSweeps } from './signature-invalidate-sweeps.ts';
import type { RevokeReason } from './signature-revoke-queries.ts';

// Invalidating every signature of one major of a document (E15-S04), for the maintainer who needs everyone to sign again without a new
// major (a clause was withdrawn). One transaction revokes the signatures of the major that are in force with a single statement,
// holds the count to the number the maintainer confirmed, appends one audit row for the whole action (each signature carries its own
// record in its revocation columns, so there are not thousands of audit rows) and sends a sweep to every repository that enforces the
// document, all or nothing. Like a revocation it is prospective and has no way back: the signers are neither deleted nor told, their
// next evaluation finds no signature and they sign again (E13). No version of the document is read or written.

/** What the services need of the world: the database and the queue the sweeps are sent to. */
export interface InvalidateDeps {
  readonly db: Kysely<Database>;
  readonly enqueuer: JobEnqueuer;
}

/** The request: the major of the document of the tenant, the reason code, the count the maintainer saw, and the person who invalidates (`users.id` for the foreign key, the GitHub id for the audit row). */
export interface MajorInvalidation extends MajorOfDocument {
  readonly reason: RevokeReason;
  readonly expectedCount: number;
  readonly actor: { readonly userId: number; readonly githubId: GithubId };
}

/**
 * Everything an invalidation does in the transaction `trx`: the document is read with the installation id, the signatures of the
 * major in force are revoked by one statement, the count is held to the confirmed one, the one audit row is appended and the sweeps are
 * sent. A count that is not the confirmed one throws before anything else is written, and the transaction rolls the revocation back.
 * @throws ClaRuleError `not_found`, `nothing_to_invalidate`, `count_changed`; whatever the enqueuer rejects with.
 */
async function invalidateWithin(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  invalidation: MajorInvalidation,
): Promise<number> {
  const { documentId, major, reason, actor } = invalidation;
  if ((await findDocumentPlacement(trx, scope, documentId)) === null) {
    throw new ClaRuleError('not_found');
  }
  const { count, revokedAt } = await invalidateActiveSignatures(trx, scope, {
    documentId,
    major,
    revokedBy: actor.userId,
    reason,
  });
  if (revokedAt === null) {
    throw new ClaRuleError('nothing_to_invalidate');
  }
  if (count !== invalidation.expectedCount) {
    throw new ClaRuleError('count_changed');
  }
  await appendAudit(trx, {
    action: 'signatures.invalidated',
    installationId: scope.installationId,
    actorGithubId: actor.githubId,
    subject: { type: 'document', id: documentId },
    metadata: { major, count, reason_code: reason },
  });
  await sendInvalidationSweeps(trx, enqueuer, scope, { documentId, major, revokedAt });
  return count;
}

/**
 * Takes every signature of the major of a document of the tenant out of force: the three revocation columns are set on all the ones in
 * force by one statement, `signatures.invalidated` is appended once (the document, the major, the count and the reason code, no name),
 * and a sweep is sent to every repository that enforces the document. Nothing is revoked unless the number of signatures in force is
 * the one the maintainer confirmed; a failure at any step, a throwing enqueuer included, rolls everything back.
 * @returns how many signatures were invalidated.
 * @throws ClaRuleError `not_found` (the tenant has no such document), `nothing_to_invalidate` (no signature of the major is in force),
 * `count_changed` (their number is not `expectedCount`). Anything the enqueuer rejects with.
 */
export async function invalidateMajor(
  deps: InvalidateDeps,
  scope: TenantScope,
  invalidation: MajorInvalidation,
): Promise<number> {
  return deps.db.transaction().execute((trx) => invalidateWithin(trx, deps.enqueuer, scope, invalidation));
}
