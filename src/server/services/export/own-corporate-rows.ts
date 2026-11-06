// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { DataExport } from '../../../shared/data-export.ts';
import type { ownCorporateAgreements, ownCorporateApprovals } from './own-corporate-queries.ts';

// The corporate part of the export of a person's own data (E21): which column becomes which field. Pure: the statements are in
// own-corporate-queries.ts and the document is put together in own-data-rows.ts.

/** One row of {@link ownCorporateAgreements}. */
export type AgreementRow = Awaited<ReturnType<typeof ownCorporateAgreements>>[number];

/** One row of {@link ownCorporateApprovals}. */
export type ApprovalRow = Awaited<ReturnType<typeof ownCorporateApprovals>>[number];

/** The agreement as the document holds it: the company and the title only while they exist. */
export const agreementOf = (row: AgreementRow): DataExport['corporateAgreements'][number] => ({
  id: row.id,
  signatureId: row.signature_id,
  installation: { githubInstallationId: row.github_installation_id, accountLogin: row.account_login },
  document: { id: row.document_id, name: row.document_name },
  major: row.major,
  signedAt: row.signed_at.toISOString(),
  revokedAt: row.revoked_at?.toISOString() ?? null,
  personalData:
    row.personal_data === null
      ? null
      : { companyName: row.personal_data.company_name, signatoryTitle: row.personal_data.signatory_title },
});

/** The approval as the document holds it: the login snapshot only while it exists, and nothing of who approved or revoked. */
export const approvalOf = (row: ApprovalRow): DataExport['corporateApprovals'][number] => ({
  id: row.id,
  agreementId: row.agreement_id,
  installation: { githubInstallationId: row.github_installation_id, accountLogin: row.account_login },
  document: { id: row.document_id, name: row.document_name },
  major: row.major,
  source: row.source,
  approvedAt: row.approved_at.toISOString(),
  expiresAt: row.expires_at?.toISOString() ?? null,
  revokedAt: row.revoked_at?.toISOString() ?? null,
  login: row.login,
});
