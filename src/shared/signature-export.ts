// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The signature CSV export of a CLA document (E16-S03): where it is read, which signatures it can be asked for, and the
// columns of the file. The route, its tests and the screen that links to it share them.

/**
 * Where a maintainer downloads the signatures of one document: `:installationId` is `installations.id` and `:documentId`
 * is `cla_documents.id`, the keys of our own tables, never GitHub's ids (E11-S05).
 */
export const SIGNATURES_CSV_PATH = '/api/installations/:installationId/documents/:documentId/signatures.csv';

/** The values of `state`: `all` takes every signature of the document, the others one state of {@link SIGNATURE_STATES}. */
export const SIGNATURE_EXPORT_STATES = ['active', 'outdated', 'revoked', 'all'] as const;

export type SignatureExportState = (typeof SIGNATURE_EXPORT_STATES)[number];

/** The `state` of a request that names none. */
export const SIGNATURE_EXPORT_DEFAULT_STATE: SignatureExportState = 'all';

/**
 * The header row of the file, in order. Network metadata (an address, a user agent) has no column on purpose, and the
 * three columns of personal data (`login`, `name`, `email`) are empty for a person whose data was erased (`pii_erased`).
 */
export const SIGNATURE_CSV_COLUMNS = [
  'signature_id',
  'github_user_id',
  'login',
  'name',
  'email',
  'document_id',
  'document_name',
  'version_major',
  'version_minor',
  'content_sha256',
  'consent_text_id',
  'signer_type',
  'signed_at',
  'source_repository',
  'source_pr_number',
  'state',
  'revoked_at',
  'revoked_by_github_id',
  'revoke_reason_code',
  'pii_erased',
] as const;
