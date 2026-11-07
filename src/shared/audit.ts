// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The closed vocabulary of the audit log (E04-S09). Every mutation names one of these actions and, in its metadata,
// only these keys; migrations/002_audit_metadata_allowlist.sql holds the same key list for the database check, and a
// test keeps the two equal. A new action or key is added in the change that adds the mutation that needs it.

/**
 * Matches the database check on `audit_log.action`.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
// eslint-disable-next-line security/detect-unsafe-regex -- linear: the literal dots between segments make every split unambiguous, and this is the database check's own pattern
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

export const AUDIT_ACTIONS = [
  'installation.rejected',
  'installation.deleted',
  'installation.suspended',
  'installation.unsuspended',
  'repository.added',
  'repository.removed',
  'repository.renamed',
  'repository.enabled',
  'repository.disabled',
  // Added by E05-S07: the admission policy decided to serve an installation (the counterpart of installation.rejected).
  'installation.admitted',
  // Added by E05-S08: the account snapshot of a stored installation changed (its login, account or the time of a
  // suspension that stays), so every change of stored state has an audit row. Ids and the type code only, no login.
  'installation.updated',
  // Added by E07-S05: the sync of an installation failed in every attempt of the queue (the dead-letter handler writes it).
  // The subject is the installation; there is no personal data.
  'installation.sync_failed',
  // Added by E12-S01: a CLA document was created, or renamed (metadata ids and the kind only, never the name).
  'cla_document.created',
  'cla_document.renamed',
  // Added by E12-S03: a draft of a CLA text was saved (metadata the document id and the new revision) or discarded (the document
  // id and the revision that was discarded). The text is never in the row.
  'cla_draft.saved',
  'cla_draft.discarded',
  // Added by E12-S04: a version of a CLA was published (metadata the ids, the number, the bump and the count of signatures it
  // affects). The text and the rationale are never in the row.
  'cla_version.published',
  // Instance-wide actions: SYSTEM_ACTIONS and INSTANCE_ACTIONS must be subsets of this list.
  'data_export.created',
  'network_metadata.purged',
  // Added by E16-S01: the names that the mutation epics (E12 to E16) document for their audit rows. The catalogue test
  // (src/server/services/audit-catalogue.test.ts) requires them and the call-site scan lists the ones no call site
  // writes yet as reserved, so a mutation that never lands cannot hide behind a name.
  'signature.created',
  'signature.revoked',
  'signatures.invalidated',
  'signatures.exported',
  'commit_override.created',
  'commit_override.deleted',
  'allowlist_entry.created',
  'allowlist_entry.deleted',
  'repository.cla_document_attached',
  'repository.cla_document_detached',
  'signer_pii.erased',
  // Added by E22-S02: a repository turned the public signature check on or off (metadata the repository id and the new flag).
  'repository.public_verification_changed',
  // Added by E22-S04: a run of the retention sweep deleted webhook deliveries or expired sessions (metadata the two counts, numbers
  // only). Instance-wide and written by a schedule, so it has neither an installation nor an actor.
  'retention.swept',
  // Added by E21-S02: a company signed a corporate CLA through its signatory (metadata ids and the major only, never the company, the
  // title, the name or an address), and a maintainer chose or removed the corporate CLA document of a repository (ids only).
  'corporate_agreement.signed',
  'repository.corporate_document_set',
  // Added by E21-S03: the CLA manager of a corporate agreement approved an employee, a domain or an organisation, or revoked an approval
  // (one row for each approval that was revoked with it). The subject is the approval; the metadata holds the kind, the numeric GitHub
  // id, the signature of the agreement and a code, never a login, an address, a domain or the reason of a revocation.
  'corporate_approval.added',
  'corporate_approval.revoked',
  // Added by E21-S04: an employee claimed coverage under an employer's agreement and a rule (an e-mail domain or an organisation the CLA
  // manager approved) matched, so a `user` approval was derived for them. The subject is the new approval; the metadata holds `kind`
  // `user`, the numeric GitHub id of the employee, the signature of the agreement and no login, address, domain or company.
  'corporate_approval.derived',
  // Added by E21: an org admin downloaded the file of the corporate agreements or the file of the approvals of a tenant, as the export of the
  // signatures is recorded. The row is committed before the first byte; the metadata holds the number of rows and nothing from the file.
  'corporate_agreements.exported',
  'corporate_approvals.exported',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Actions that scheduled work or a webhook performs, so no person is the actor and `actorGithubId` may be `null`.
 * The installation lifecycle and the repository sync of E05 are driven by webhooks; the metadata purge and the retention sweep
 * (E22-S04) are schedules.
 */
export const SYSTEM_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'installation.rejected',
  'installation.admitted',
  'installation.updated',
  'installation.sync_failed',
  'installation.deleted',
  'installation.suspended',
  'installation.unsuspended',
  'repository.added',
  'repository.removed',
  'repository.renamed',
  'network_metadata.purged',
  'retention.swept',
]);

/** Actions that belong to the whole instance and not to one tenant, so `installationId` may be `null`. */
export const INSTANCE_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'data_export.created',
  'network_metadata.purged',
  'retention.swept',
]);

/**
 * The only keys audit metadata may carry: ids, counts, flags and codes. Personal data (`name`, `email`, `login`,
 * `avatar_url`) and free text (`reason`, `message`, `title`, `text`) are not members and must never become members.
 */
export const AUDIT_METADATA_KEYS = [
  // The 12 keys of migration 001.
  'count',
  'signer_pii_rows',
  'document_id',
  'version_id',
  'signature_id',
  'repository_id',
  'pr_number',
  'major',
  'minor',
  'reason_code',
  'kind',
  'enabled',
  // Added by migration 002.
  'account_id',
  'account_type',
  'scope',
  'github_id',
  'user_github_id',
  'previous_document_id',
  'source_repository_id',
  'source_pr_number',
  'revision',
  'bump',
  'affected_signatures',
  'rolled_back_from_version_id',
  'commit_sha',
  'state',
  'row_count',
  'rows',
  'signature_count',
  'webhook_deliveries',
  'sessions',
] as const;

export type AuditMetadataKey = (typeof AUDIT_METADATA_KEYS)[number];
