// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SIGNATURE_CSV_COLUMNS } from '../../../shared/signature-export.ts';
import { encodeCsvRow } from '../../domain/csv.ts';
import { signatureState } from '../../domain/signature-state.ts';
import type { SignatureBatchRow } from './signature-queries.ts';

// A signature as one line of the export (E16-S03): which cell holds what. Every cell goes through the encoder of
// src/server/domain/csv.ts, so none of them, whoever wrote it, can start a formula.

/** The header row of the file. */
export const HEADER_ROW = encodeCsvRow(SIGNATURE_CSV_COLUMNS);

/** A number or text as a cell; nothing (a column that has no value for this signature) as an empty one. */
const cell = (value: string | number | null): string => (value === null ? '' : String(value));

/** An instant as ISO 8601 in UTC with milliseconds, or an empty cell. */
const instant = (value: Date | null): string => (value === null ? '' : value.toISOString());

/**
 * The line of one signature, CRLF included. The personal data (`login`, `name`, `email`) is what `signer_pii` still holds:
 * once the person was erased the three cells are empty and `pii_erased` says why. Network metadata has no column.
 */
export function csvRowOf(row: SignatureBatchRow): string {
  return encodeCsvRow([
    cell(row.signature_id),
    cell(row.github_user_id),
    cell(row.pii_login),
    cell(row.pii_name),
    cell(row.pii_email),
    cell(row.document_id),
    cell(row.document_name),
    cell(row.version_major),
    cell(row.version_minor),
    cell(row.content_sha256),
    cell(row.consent_text_id),
    cell(row.signer_type),
    instant(row.signed_at),
    cell(row.source_repository),
    cell(row.source_pr_number),
    signatureState({ revoked: row.revoked_at !== null, major: row.version_major }, row.active_major),
    instant(row.revoked_at),
    cell(row.revoked_by_github_id),
    cell(row.revoke_reason),
    String(row.pii_erased),
  ]);
}
