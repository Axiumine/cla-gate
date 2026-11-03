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
  // Instance-wide actions: SYSTEM_ACTIONS and INSTANCE_ACTIONS must be subsets of this list.
  'data_export.created',
  'network_metadata.purged',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Actions that scheduled work or a webhook performs, so no person is the actor and `actorGithubId` may be `null`.
 * The installation lifecycle and the repository sync of E05 are driven by webhooks; the metadata purge is a schedule.
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
]);

/** Actions that belong to the whole instance and not to one tenant, so `installationId` may be `null`. */
export const INSTANCE_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'data_export.created',
  'network_metadata.purged',
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
