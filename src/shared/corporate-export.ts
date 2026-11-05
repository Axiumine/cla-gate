// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The CSV exports of the corporate CLA of a tenant (E21-S05): where an org admin downloads them and the columns of each file. The routes, their
// tests and any screen that links to them share them. `:installationId` is `installations.id`, the key of our own table, never GitHub's id (E11-S05).

/** The agreements of the tenant, one row each, revoked ones included. */
export const CORPORATE_AGREEMENTS_CSV_PATH = '/api/installations/:installationId/corporate-agreements.csv';

/** The approvals of every agreement of the tenant, one row each, in force, expired and revoked. */
export const CORPORATE_APPROVALS_CSV_PATH = '/api/installations/:installationId/approvals.csv';

/**
 * The header row of the agreements file, in order. `company_name` and `signatory_login` are what the erasable tables still hold: both are empty for a
 * signatory who was erased. `signatory_github_id` is the numeric id, the identity. `revoked` is `true` once the signature of the agreement was revoked.
 */
export const CORPORATE_AGREEMENT_CSV_COLUMNS = [
  'agreement_id',
  'signed_at',
  'major',
  'company_name',
  'signatory_github_id',
  'signatory_login',
  'revoked',
] as const;

/**
 * The header row of the approvals file, in order. `subject` is the numeric GitHub id of the user or organisation, or the domain of an
 * `email_domain` approval; the login snapshot of an account is not in the file (it is erasable and the id is the identity).
 */
export const CORPORATE_APPROVAL_CSV_COLUMNS = [
  'approval_id',
  'agreement_id',
  'kind',
  'subject',
  'source',
  'approved_at',
  'expires_at',
  'revoked_at',
] as const;
