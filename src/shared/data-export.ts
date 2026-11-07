// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';

// The data subject export (E16-S06): everything the instance holds about the signed-in person, across all orgs, as one JSON
// document. The route, its tests and the page that offers the download share the path and the shape. Nothing in it names
// another person: not who revoked a signature, not who created an allowlist entry, not the actor of an audit row.

/** Where a signed-in person downloads their own data. There is no id in the path or the query: the subject is the session user. */
export const DATA_EXPORT_PATH = '/api/me/export';

/** The version of the document. A change that is not additive raises it. */
export const DATA_EXPORT_SCHEMA_VERSION = 1;

/** The most audit entries one export holds; when more exist the newest are kept and `truncated` is `true`. */
export const DATA_EXPORT_AUDIT_LIMIT = 1000;

/** An instant as ISO 8601 in UTC with milliseconds. */
const instant = z.iso.datetime({ offset: false });

const id = z.int().positive();

/**
 * The personal data held for one signature (`signer_pii`). The network values are present only when the instance recorded them
 * for that signature (E13-S05) and are `null` otherwise.
 */
const personalDataSchema = z.object({
  name: z.string(),
  email: z.string(),
  login: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

/**
 * One signature of the person. `personalData` is `null` once the personal data was erased (E16-S04): the signature stays and
 * so does this row. Who revoked it is not included, because that is another person's identity.
 */
const signatureSchema = z.object({
  id,
  installation: z.object({ githubInstallationId: id, accountLogin: z.string() }),
  document: z.object({ id, name: z.string() }),
  version: z.object({
    id,
    major: z.int().nonnegative(),
    minor: z.int().nonnegative(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  consentTextId: z.string(),
  signerType: z.enum(['individual', 'corporate']),
  signedAt: instant,
  source: z.object({ repositoryFullName: z.string().nullable(), prNumber: id.nullable() }),
  revokedAt: instant.nullable(),
  revokeReasonCode: z.enum(['signer_request', 'maintainer_decision', 'legal_request', 'other']).nullable(),
  personalData: personalDataSchema.nullable(),
});

/**
 * A corporate CLA the person signed as the authorised signatory of a company (E21). The signature itself is also in `signatures`
 * with `signerType` `corporate`. `personalData` is the company and the title the person gave, and `null` once they were erased
 * (E16-S04): the agreement stays. Who is approved under it is not included, because those are other people.
 */
const corporateAgreementSchema = z.object({
  id,
  signatureId: id,
  installation: z.object({ githubInstallationId: id, accountLogin: z.string() }),
  document: z.object({ id, name: z.string() }),
  major: z.int().nonnegative(),
  signedAt: instant,
  revokedAt: instant.nullable(),
  personalData: z.object({ companyName: z.string(), signatoryTitle: z.string() }).nullable(),
});

/**
 * An approval that names the person by their numeric GitHub id, under a corporate CLA of a company: given by a CLA manager
 * (`source` `manager`) or derived from a domain or organisation approval (`rule`, which then expires). Approvals of a domain or
 * of an organisation name no person and are not here. `login` is the snapshot kept for display, `null` once erased. Who approved,
 * who revoked and the free text of the reason are not included: the first two are other people, and the third is typed by one.
 */
const corporateApprovalSchema = z.object({
  id,
  agreementId: id,
  installation: z.object({ githubInstallationId: id, accountLogin: z.string() }),
  document: z.object({ id, name: z.string() }),
  major: z.int().nonnegative(),
  source: z.enum(['manager', 'rule']),
  approvedAt: instant,
  expiresAt: instant.nullable(),
  revokedAt: instant.nullable(),
  login: z.string().nullable(),
});

/** An allowlist entry that names the person (by the numeric GitHub id): where it applies and what kind it is, not who made it. */
const allowlistEntrySchema = z.object({
  installation: z.object({ accountLogin: z.string() }),
  scope: z.enum(['installation', 'repository']),
  kind: z.enum(['user', 'bot', 'org_members']),
  createdAt: instant,
});

/**
 * An audit row in which the person is the actor or the subject. `installationId` is GitHub's id of the installation, as in the
 * signatures, and `null` for an action of the whole instance. The metadata and the other party are not included.
 */
const auditEntrySchema = z.object({
  occurredAt: instant,
  action: z.string().min(1),
  installationId: id.nullable(),
  subject: z.object({ type: z.string().min(1), id }).nullable(),
});

/**
 * The export. `auditEntries` are newest first and at most {@link DATA_EXPORT_AUDIT_LIMIT}; `truncated` says that older ones exist.
 * The row that records this very export (`data_export.created`) is not in it: it is written once the data is read, and the
 * next export shows it.
 */
export const dataExportSchema = z.object({
  schemaVersion: z.literal(DATA_EXPORT_SCHEMA_VERSION),
  exportedAt: instant,
  user: z.object({ githubId: id, login: z.string(), name: z.string().nullable(), createdAt: instant }),
  signatures: z.array(signatureSchema),
  corporateAgreements: z.array(corporateAgreementSchema),
  corporateApprovals: z.array(corporateApprovalSchema),
  allowlistEntries: z.array(allowlistEntrySchema),
  auditEntries: z.array(auditEntrySchema),
  truncated: z.boolean(),
});

export type DataExport = z.infer<typeof dataExportSchema>;

/**
 * `GET /api/me/export` as the client calls it (E18-S03): no params, no query and no body, because the subject is the session
 * user and nobody can be named. The server answers with the document as a download; the "my signatures" screen asks through the
 * typed client, so a refusal (a `429` when the five an hour are used up) arrives as an `ApiError` the screen can show.
 */
export const dataExportRoute = defineRoute({
  method: 'GET',
  path: DATA_EXPORT_PATH,
  responses: { 200: dataExportSchema },
});
