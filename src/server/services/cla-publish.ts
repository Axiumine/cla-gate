// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import { normaliseRationale } from '../../shared/cla-version.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { isUniqueViolation } from '../adapters/db/violations.ts';
import { appendAudit } from './audit.ts';
import { deleteDraft } from './cla-draft-writes.ts';
import { decide } from './cla-publish-checks.ts';
import type { PublishedVersion, VersionPublish } from './cla-publish-types.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { enqueueVersionSweeps } from './cla-version-sweeps.ts';
import { insertVersion, setActiveVersion } from './cla-version-writes.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// Publishing a version of a CLA (E12-S04): the one mutation that creates `cla_versions` rows and moves the active pointer. It
// is one transaction under the lock of the document row, so the checks, the number, the insert, the pointer, the draft, the audit
// row and the jobs are decided together and either all happen or none does. The checks are in cla-publish-checks.ts, the shapes in
// cla-publish-types.ts, the statements in cla-version-queries.ts and cla-version-writes.ts; the numbering is `nextVersionNumber`. Whoever publishes later from another source (E12-S06, a copy of an
// old version) reuses `publishWithin` with a source of its own and changes nothing else.

/** The unique constraint on `(document_id, major, minor)` of migration 001: the backstop of the numbering. */
const VERSION_NUMBER_CONSTRAINT = 'cla_versions_document_id_major_minor_key';

/**
 * Everything a publish does, in the transaction `trx`: the checks, the insert, the pointer, the draft, the audit row and, for a
 * major bump, the jobs.
 * @throws ClaRuleError a rule the publish breaks; the database error of a number that is taken is the caller's to read.
 */
async function publishWithin(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  publish: VersionPublish,
): Promise<PublishedVersion> {
  const { number, text, requiresResigning, affectedSignatures } = await decide(trx, scope, publish);
  const { documentId, actor } = publish;
  const version = await insertVersion(trx, scope, {
    documentId,
    ...number,
    contentMd: text.contentMd,
    contentSha256: text.contentSha256,
    publishedBy: actor.id,
    rationale: publish.rationale,
  });
  await setActiveVersion(trx, scope, documentId, version.id);
  await deleteDraft(trx, scope, documentId);
  await appendAudit(trx, {
    action: 'cla_version.published',
    installationId: scope.installationId,
    actorGithubId: actor.githubId,
    subject: { type: 'cla_version', id: version.id },
    metadata: {
      document_id: documentId,
      version_id: version.id,
      major: version.major,
      minor: version.minor,
      bump: publish.bump,
      affected_signatures: affectedSignatures,
    },
  });
  if (publish.bump === 'major') {
    await enqueueVersionSweeps(trx, scope, enqueuer, { documentId, versionId: version.id });
  }
  return { version, requiresResigning, affectedSignatures };
}

/**
 * Publishes the saved draft of a document as its next version and makes it the active one. One transaction under
 * `select ... for update` of the document row, so two publishes that name the same active version cannot both succeed: the
 * second waits, finds the pointer moved and is refused. The rationale is stored with the version and never copied into the audit
 * row. A failure at any step, a throwing enqueuer included, rolls everything back: no version row, no audit row, the pointer
 * and the draft as they were.
 * @throws ClaRuleError `invalid_rationale`, `not_found`, `stale_active_version` (with `activeVersionId`), `first_version_must_be_major`,
 * `draft_conflict` (with `currentRevision`), the `content_` rules, `content_unchanged`, `resign_confirmation_required` (with
 * `affectedSignatures`) and `version_conflict` (the number was taken by a row the lock could not see). Anything the enqueuer rejects with.
 */
export async function publishVersion(
  db: Kysely<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  publish: VersionPublish,
): Promise<PublishedVersion> {
  const rationale = normaliseRationale(publish.rationale);
  if (rationale === null) {
    throw new ClaRuleError('invalid_rationale');
  }
  try {
    return await db.transaction().execute((trx) => publishWithin(trx, scope, enqueuer, { ...publish, rationale }));
  } catch (error) {
    throw isUniqueViolation(error, VERSION_NUMBER_CONSTRAINT) ? new ClaRuleError('version_conflict') : error;
  }
}
