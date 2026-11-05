// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { countEnforcingRepositories } from './cla-enforcing-queries.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { findDocumentPlacement } from './document-placement.ts';
import { countActiveSignatures, type MajorOfDocument } from './signature-invalidate-queries.ts';

// What invalidating a major would do, as counts only (E15-S04): the maintainer reads them before confirming, and the confirmation
// carries the first one back as `expectedCount`. Nothing is written and no signer is named.

/** What a preview counts: the signatures that an invalidation would revoke, and the repositories it would sweep. */
export interface InvalidationPreview {
  readonly activeSignatures: number;
  readonly affectedRepositories: number;
}

/**
 * What invalidating the major would do now, as counts: the signatures of the major in force, and the enabled repositories that enforce
 * the document, each of which would be swept. The document is read with the installation id, so another tenant's is not found.
 * @throws ClaRuleError `not_found` when the tenant has no such document.
 */
export async function previewInvalidation(
  db: Kysely<Database>,
  scope: TenantScope,
  target: MajorOfDocument,
): Promise<InvalidationPreview> {
  if ((await findDocumentPlacement(db, scope, target.documentId)) === null) {
    throw new ClaRuleError('not_found');
  }
  const [activeSignatures, affectedRepositories] = await Promise.all([
    countActiveSignatures(db, scope, target),
    countEnforcingRepositories(db, scope, target.documentId),
  ]);
  return { activeSignatures, affectedRepositories };
}
