// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { DATA_EXPORT_AUDIT_LIMIT, DATA_EXPORT_SCHEMA_VERSION, type DataExport } from '../../../shared/data-export.ts';
import { type AgreementRow, type ApprovalRow, agreementOf, approvalOf } from './own-corporate-rows.ts';
import type { ownAllowlistEntries, ownAuditEntries } from './own-data-queries.ts';
import type { ownSignatures } from './own-signatures-query.ts';

// The export of a person's own data as the document of src/shared/data-export.ts (E16-S06): which column becomes which field.
// Pure: the statements are in own-data-queries.ts and the transaction in own-data.ts.

type SignatureRow = Awaited<ReturnType<typeof ownSignatures>>[number];
type AllowlistRow = Awaited<ReturnType<typeof ownAllowlistEntries>>[number];
type AuditRow = Awaited<ReturnType<typeof ownAuditEntries>>[number];

/** The person as the `users` row holds them. */
interface ExportedUser {
  readonly githubId: number;
  readonly login: string;
  readonly name: string | null;
  readonly createdAt: Date;
}

/** Everything one export is made of, as read from one snapshot. */
export interface OwnData {
  readonly now: Date;
  readonly user: ExportedUser;
  readonly signatures: readonly SignatureRow[];
  readonly corporateAgreements: readonly AgreementRow[];
  readonly corporateApprovals: readonly ApprovalRow[];
  readonly allowlistEntries: readonly AllowlistRow[];
  /** At most {@link DATA_EXPORT_AUDIT_LIMIT} + 1 rows: the extra one only says that older rows exist. */
  readonly auditEntries: readonly AuditRow[];
}

const signatureOf = (row: SignatureRow): DataExport['signatures'][number] => ({
  id: row.id,
  installation: { githubInstallationId: row.github_installation_id, accountLogin: row.account_login },
  document: { id: row.document_id, name: row.document_name },
  version: { id: row.version_id, major: row.major, minor: row.minor, contentSha256: row.content_sha256 },
  consentTextId: row.consent_text_id,
  signerType: row.signer_type,
  signedAt: row.signed_at.toISOString(),
  source: { repositoryFullName: row.source_repository, prNumber: row.source_pr_number },
  revokedAt: row.revoked_at?.toISOString() ?? null,
  revokeReasonCode: row.revoke_reason,
  personalData:
    row.personal_data === null
      ? null
      : {
          name: row.personal_data.name,
          email: row.personal_data.email,
          login: row.personal_data.login,
          ipAddress: row.personal_data.ip_address,
          userAgent: row.personal_data.user_agent,
        },
});

const allowlistEntryOf = (row: AllowlistRow): DataExport['allowlistEntries'][number] => ({
  installation: { accountLogin: row.account_login },
  scope: row.repository_id === null ? 'installation' : 'repository',
  kind: row.kind,
  createdAt: row.created_at.toISOString(),
});

const auditEntryOf = (row: AuditRow): DataExport['auditEntries'][number] => ({
  occurredAt: row.occurred_at.toISOString(),
  action: row.action,
  installationId: row.github_installation_id,
  subject: row.subject_type === null || row.subject_id === null ? null : { type: row.subject_type, id: row.subject_id },
});

/**
 * The document for `data`. The audit entries are cut to {@link DATA_EXPORT_AUDIT_LIMIT} and `truncated` is true when the
 * statement found more than that. The arrays keep the order of the rows, which the statements fixed.
 */
export function buildDataExport(data: OwnData): DataExport {
  return {
    schemaVersion: DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: data.now.toISOString(),
    user: {
      githubId: data.user.githubId,
      login: data.user.login,
      name: data.user.name,
      createdAt: data.user.createdAt.toISOString(),
    },
    signatures: data.signatures.map(signatureOf),
    corporateAgreements: data.corporateAgreements.map(agreementOf),
    corporateApprovals: data.corporateApprovals.map(approvalOf),
    allowlistEntries: data.allowlistEntries.map(allowlistEntryOf),
    auditEntries: data.auditEntries.slice(0, DATA_EXPORT_AUDIT_LIMIT).map(auditEntryOf),
    truncated: data.auditEntries.length > DATA_EXPORT_AUDIT_LIMIT,
  };
}
