// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { VersionNumber } from '../domain/version-number.ts';
import { sha256Hex } from './cla-content.ts';
import { findVersion, listVersions } from './cla-history-queries.ts';
import type { HistoryVersion, HistoryVersionText } from './cla-history-rows.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// The history of a CLA document and the exact text of a version (E12-S05). Read only: a published version never changes, and
// nothing here writes. The statements are in cla-history-queries.ts. The text a version is shown with is checked against the
// hash it was published with before it leaves the service.

/** One page of the history: the versions, newest number first, and where the next page starts (null on the last page). */
export interface VersionPage {
  readonly versions: readonly HistoryVersion[];
  readonly next: VersionNumber | null;
}

/**
 * A page of the versions of the document of the tenant by `major desc, minor desc`: `limit` rows from `from` (inclusive). One
 * row more than the page is read: it tells whether more follow, and it is where the next page starts. A document with no
 * version, and one the tenant does not have, give an empty page; the route has already turned the second into a `404`.
 */
export async function listVersionPage(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
  page: { readonly limit: number; readonly from: VersionNumber | null },
): Promise<VersionPage> {
  const rows = await listVersions(db, scope, documentId, { limit: page.limit + 1, from: page.from });
  const following = rows[page.limit];
  return {
    versions: rows.slice(0, page.limit),
    next: following === undefined ? null : { major: following.major, minor: following.minor },
  };
}

/** The part of a logger the integrity check uses: one error with plain fields. A request's logger is one. */
export interface IntegrityLog {
  error(fields: object, message: string): void;
}

/** Where a version is read from. The database is the only source; the seam is for the test that hands the check a row the database would never hold. */
export interface VersionReads {
  readonly findVersion: typeof findVersion;
}

const DATABASE_READS: VersionReads = { findVersion };

/**
 * The stored text of a version does not hash to the stored hash. The database check on `cla_versions` makes this unreachable
 * in normal operation; if it ever happens the text must not be served as the exact text of that version. It is not an
 * `AppError`: the client gets the plain `500` of any server fault, and the message holds nothing of the row.
 * @internal exported for the tests, which look for it
 */
export class VersionIntegrityError extends Error {
  override readonly name = 'VersionIntegrityError';

  constructor() {
    super('the stored text of a version does not match its hash');
  }
}

/**
 * The version `versionId` of the document `documentId` of the tenant with its exact text. The SHA-256 of the text is computed
 * again and compared with the stored one before the text is returned.
 * @throws ClaRuleError `not_found` when that document of the tenant has no such version (another document's version and
 * another tenant's are the same answer).
 * @throws VersionIntegrityError when the text does not hash to the stored hash; `cla_version_integrity_failed` is logged first,
 * with the ids of the installation, the document and the version and nothing of the row.
 */
export async function readVersion(
  db: Kysely<Database>,
  scope: TenantScope,
  ids: { readonly documentId: number; readonly versionId: number },
  deps: { readonly log: IntegrityLog; readonly reads?: VersionReads },
): Promise<HistoryVersionText> {
  const reads = deps.reads ?? DATABASE_READS;
  const version = await reads.findVersion(db, scope, ids.documentId, ids.versionId);
  if (version === null) {
    throw new ClaRuleError('not_found');
  }
  if (sha256Hex(version.contentMd) !== version.contentSha256) {
    deps.log.error(
      { installationId: scope.installationId, documentId: ids.documentId, versionId: ids.versionId },
      'cla_version_integrity_failed',
    );
    throw new VersionIntegrityError();
  }
  return version;
}
