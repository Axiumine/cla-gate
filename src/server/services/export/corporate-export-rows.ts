// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CORPORATE_AGREEMENT_CSV_COLUMNS, CORPORATE_APPROVAL_CSV_COLUMNS } from '../../../shared/corporate-export.ts';
import { encodeCsvRow } from '../../domain/csv.ts';
import type { AgreementExportRow, ApprovalExportRow } from './corporate-export-queries.ts';

// An agreement and an approval as one line of their export (E21-S05): which cell holds what. Every cell goes through the encoder of
// src/server/domain/csv.ts (E16-S03), so none of them, whoever wrote it, can start a formula: a company name that opens with `=`, or a login that
// opens with `@`, leaves the file with a single quote in front of it.

/** The header row of the agreements file. */
export const AGREEMENT_HEADER_ROW = encodeCsvRow(CORPORATE_AGREEMENT_CSV_COLUMNS);

/** The header row of the approvals file. */
export const APPROVAL_HEADER_ROW = encodeCsvRow(CORPORATE_APPROVAL_CSV_COLUMNS);

/** A number or text as a cell; nothing (a column that has no value for this row, or one that erasure emptied) as an empty one. */
const cell = (value: string | number | null): string => (value === null ? '' : String(value));

/** An instant as ISO 8601 in UTC with milliseconds, or an empty cell. */
const instant = (value: Date | null): string => (value === null ? '' : value.toISOString());

/** The line of one agreement, CRLF included. The company and the login are what the erasable tables still hold: empty after an erasure. */
export function agreementCsvRow(row: AgreementExportRow): string {
  return encodeCsvRow([
    cell(row.agreementId),
    instant(row.signedAt),
    cell(row.major),
    cell(row.companyName),
    cell(row.signatoryGithubId),
    cell(row.signatoryLogin),
    String(row.revoked),
  ]);
}

/** The subject of an approval: the numeric id of the user or organisation, or the domain. A row has one of the two (a check of migration 020). */
const subjectOf = (row: ApprovalExportRow): string => cell(row.subjectGithubId ?? row.subjectDomain);

/** The line of one approval, CRLF included. */
export function approvalCsvRow(row: ApprovalExportRow): string {
  return encodeCsvRow([
    cell(row.approvalId),
    cell(row.agreementId),
    row.kind,
    subjectOf(row),
    row.source,
    instant(row.approvedAt),
    instant(row.expiresAt),
    instant(row.revokedAt),
  ]);
}
