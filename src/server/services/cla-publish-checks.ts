// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { VersionBump } from '../../shared/cla-version.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { nextVersionNumber, type VersionNumber } from '../domain/version-number.ts';
import type { PreparedClaText } from './cla-content.ts';
import type { StoredActiveVersion } from './cla-document-types.ts';
import { checkMinorBump, loadSourceText } from './cla-publish-source.ts';
import type { VersionPublish } from './cla-publish-types.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { countSignaturesAtMajor, findActiveVersion, lockDocument } from './cla-version-queries.ts';

// The checks that decide whether a publish of a version may go on (E12-S04), all made in the transaction of the caller under the
// lock of the document row and all before anything is written: the expected active version, the number, the source of the text
// (cla-publish-source.ts: the draft, or a version to publish again, E12-S06), a `minor` bump that changes nothing or that rolls
// back across a major, and the confirmation of the re-signing. The transaction that writes is in cla-publish.ts.

/**
 * Locks the document and checks that the active version is the one the person saw.
 * @returns the active version of the document, or null when it has none.
 * @throws ClaRuleError `not_found` when the tenant has no such document, `stale_active_version` with `activeVersionId` when
 * another publish got there first.
 */
async function lockActive(
  trx: Transaction<Database>,
  scope: TenantScope,
  publish: VersionPublish,
): Promise<StoredActiveVersion | null> {
  const locked = await lockDocument(trx, scope, publish.documentId);
  if (locked === null) {
    throw new ClaRuleError('not_found');
  }
  if (locked.activeVersionId !== publish.expectedActiveVersionId) {
    throw new ClaRuleError('stale_active_version', { activeVersionId: locked.activeVersionId });
  }
  return findActiveVersion(trx, scope, publish.documentId);
}

/**
 * The number the new version takes.
 * @throws ClaRuleError `first_version_must_be_major` when the document has no version and the bump is `minor`.
 */
function numberOf(active: VersionNumber | null, bump: VersionBump): VersionNumber {
  const next = nextVersionNumber(active, bump);
  if (!next.ok) {
    throw new ClaRuleError(next.rule);
  }
  return next.number;
}

/** What the re-signing guard found: whether the bump asks everyone to sign again and how many signatures that stales. */
interface Resigning {
  readonly requiresResigning: boolean;
  readonly affectedSignatures: number;
}

/**
 * A major bump over an existing version makes the signatures of the previous major stale. When there are some, the person must
 * have said they know (`acknowledgeResigning`) before anything is written.
 * @throws ClaRuleError `resign_confirmation_required` with `affectedSignatures` when they have not.
 */
async function checkResigning(
  trx: Transaction<Database>,
  scope: TenantScope,
  publish: VersionPublish,
  active: StoredActiveVersion | null,
): Promise<Resigning> {
  if (publish.bump !== 'major' || active === null) {
    return { requiresResigning: false, affectedSignatures: 0 };
  }
  const affectedSignatures = await countSignaturesAtMajor(trx, scope, publish.documentId, active.major);
  if (affectedSignatures > 0 && !publish.acknowledgeResigning) {
    throw new ClaRuleError('resign_confirmation_required', { affectedSignatures });
  }
  return { requiresResigning: true, affectedSignatures };
}

/**
 * The checks that decide whether the publish may go on, in order, all before anything is written: the lock and the expected
 * active version, the number, the source of the text, a `minor` bump that rolls back across a major or changes nothing, and the
 * confirmation of the re-signing. `rolledBackFrom` is the id of the version the new one is a copy of, or null for a draft.
 * @throws ClaRuleError the first rule the publish breaks.
 */
export async function decide(
  trx: Transaction<Database>,
  scope: TenantScope,
  publish: VersionPublish,
): Promise<{ number: VersionNumber; text: PreparedClaText; rolledBackFrom: number | null } & Resigning> {
  const active = await lockActive(trx, scope, publish);
  const number = numberOf(active, publish.bump);
  const source = await loadSourceText(trx, scope, publish);
  // A major bump with the same text is allowed on purpose: it asks everyone to sign again without a change of wording.
  if (publish.bump === 'minor') {
    checkMinorBump(active, source);
  }
  return {
    number,
    text: source.text,
    rolledBackFrom: source.copied?.id ?? null,
    ...(await checkResigning(trx, scope, publish, active)),
  };
}
