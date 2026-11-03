// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { type PreparedClaText, prepareClaText } from './cla-content.ts';
import type { StoredActiveVersion } from './cla-document-types.ts';
import { lockDraft } from './cla-draft-queries.ts';
import { findVersion } from './cla-history-queries.ts';
import type { VersionPublish } from './cla-publish-types.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// Where the text of a new version of a CLA comes from (E12-S04, E12-S06): the saved draft, or the text of a version the document
// already has, published again as a new row (a rollback). Both are read in the transaction of the publish, after the lock of the
// document row, and a `minor` bump is held to the two rules that keep a copy from changing what signers agreed to. The other
// checks of a publish are in cla-publish-checks.ts.

/** The text of the new version and, for a rollback, the version it is a copy of. */
interface SourceText {
  readonly text: PreparedClaText;
  readonly copied: StoredActiveVersion | null;
}

/**
 * The text of the new version when the source is the saved draft: locked until the transaction ends, made canonical, checked
 * and hashed again (the draft was checked when it was saved; the check is cheap and the version is for ever).
 * @throws ClaRuleError `draft_conflict` with the revision the draft is at (null: none is saved) when it is not the revision
 * the person published, and the `content_` rules if the stored draft breaks one.
 */
async function loadDraftText(
  trx: Transaction<Database>,
  scope: TenantScope,
  documentId: number,
  revision: number,
): Promise<SourceText> {
  const draft = await lockDraft(trx, scope, documentId);
  if (draft?.revision !== revision) {
    throw new ClaRuleError('draft_conflict', { currentRevision: draft?.revision ?? null });
  }
  return { text: prepareClaText(draft.contentMd), copied: null };
}

/**
 * The text of the new version when the source is a version of the same document (E12-S06): the text and the hash of that row,
 * byte for byte. A published text is canonical and validated already, and the database checks the hash again when the copy is
 * inserted, so nothing is computed here. The row is looked up by id, document and installation, like a read of the history.
 * @throws ClaRuleError `not_found` when that document of the tenant has no such version (another document's, another tenant's
 * or none: the same answer).
 */
async function loadVersionText(
  trx: Transaction<Database>,
  scope: TenantScope,
  documentId: number,
  versionId: number,
): Promise<SourceText> {
  const source = await findVersion(trx, scope, documentId, versionId);
  if (source === null) {
    throw new ClaRuleError('not_found');
  }
  return { text: { contentMd: source.contentMd, contentSha256: source.contentSha256 }, copied: source };
}

/** The text of the new version, from the source the publish names. @throws ClaRuleError what {@link loadDraftText} and {@link loadVersionText} throw. */
export function loadSourceText(
  trx: Transaction<Database>,
  scope: TenantScope,
  publish: VersionPublish,
): Promise<SourceText> {
  const { source, documentId } = publish;
  return source.type === 'draft'
    ? loadDraftText(trx, scope, documentId, source.revision)
    : loadVersionText(trx, scope, documentId, source.versionId);
}

/**
 * The two ways a `minor` bump can change nothing the signers agreed to, or more than they agreed to. A copy of a version of
 * another major would change the terms of everyone who signed the current major without asking them again, so it must be a
 * `major` bump; a text equal to the active text is no new version.
 * @throws ClaRuleError `rollback_requires_major` when the source is a version of another major than the active one,
 * `content_unchanged` when the text equals the active text.
 */
export function checkMinorBump(active: StoredActiveVersion | null, source: SourceText): void {
  if (source.copied !== null && source.copied.major !== active?.major) {
    throw new ClaRuleError('rollback_requires_major');
  }
  if (active?.contentSha256 === source.text.contentSha256) {
    throw new ClaRuleError('content_unchanged');
  }
}
