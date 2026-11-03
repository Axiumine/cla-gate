// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

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
const instant = z.iso.datetime();

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
  allowlistEntries: z.array(allowlistEntrySchema),
  auditEntries: z.array(auditEntrySchema),
  truncated: z.boolean(),
});

export type DataExport = z.infer<typeof dataExportSchema>;
