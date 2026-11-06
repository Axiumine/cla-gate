// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { buffer } from 'node:stream/consumers';
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import {
  type Corporation,
  insertApprovalRow,
  personWithId,
  publishCorporateDocument,
  type Signed,
  signAgreement,
} from '../../../adapters/db/corporate-fixture/test-support.ts';
import type { Database } from '../../../adapters/db/schema.ts';
import type { TenantScope } from '../../../adapters/db/tenant-scope.ts';
import { seedTenant, type Tenant } from '../../../adapters/db/test-support.ts';
import { type CorporateExportKind, openCorporateExport } from '../corporate-export.ts';

// What the tests of the corporate exports (E21-S05) share: a tenant with a corporate document, agreements whose company and signatory the test
// chooses, approvals with the instants the test chooses (the columns of an approval take any instant; only a signature is stamped by the database
// clock), and the export read to its end.

/** What an export produced: the file as text and the errors the end of its snapshot reported. */
export interface CorporateExportRun {
  readonly text: string;
  readonly releaseErrors: readonly unknown[];
}

/** The person who exports in the tests, unless a test names another. */
export const EXPORTER = parseGithubId(9999);

/** Opens the export of `kind` for the tenant, as `actor`, and reads it to the end. */
export async function runCorporateExport(
  db: Kysely<Database>,
  scope: TenantScope,
  kind: CorporateExportKind,
  actor: GithubId = EXPORTER,
): Promise<CorporateExportRun> {
  const releaseErrors: unknown[] = [];
  const stream = await openCorporateExport(db, scope, kind, {
    actor,
    onReleaseError: releaseErrors.push.bind(releaseErrors),
  });
  const text = (await buffer(stream)).toString('utf8');
  // The snapshot is committed when the stream closes, which is just after the last byte was read.
  await new Promise((resolve) => setImmediate(resolve));
  return { text, releaseErrors };
}

/** A tenant, numbered `n`, with its corporate document. */
export async function corporationOf(db: Kysely<Database>, n = 1): Promise<Corporation & { readonly tenant: Tenant }> {
  const tenant = await seedTenant(db, n);
  return { tenant, document: await publishCorporateDocument(db, tenant) };
}

/** The person with this numeric GitHub id signs an agreement for `companyName`, and their login snapshot is `login`. */
export async function signFor(
  db: Kysely<Database>,
  corporation: Corporation,
  who: { readonly githubId: number; readonly companyName: string; readonly login?: string },
): Promise<Signed> {
  const person = await personWithId(db, who.githubId);
  const signed = await signAgreement(db, corporation, person, {
    companyName: who.companyName,
    signatoryTitle: 'Chief Legal Officer',
  });
  if (who.login !== undefined) {
    await sql`update signer_pii set login = ${who.login} where signature_id = ${signed.signatureId}`.execute(db);
  }
  return signed;
}

/** The first instant of the approvals the tests store: each is a number of hours after it. */
const EPOCH = Date.parse('2026-10-15T09:00:00.000Z');

/** The instant `hours` hours after the first one. */
export const hoursAfterEpoch = (hours: number): Date => new Date(EPOCH + hours * 3_600_000);

/** What an approval is about: an account by its numeric id, or a domain. */
type Subject =
  | { readonly kind: 'user' | 'github_org'; readonly githubId: number }
  | { readonly kind: 'email_domain'; readonly domain: string };

/** An approval by the manager (the signatory) of an account or a domain, approved at the instant `at`. */
export function approveAt(db: Kysely<Database>, signed: Signed, subject: Subject, at: Date): Promise<number> {
  return insertApprovalRow(db, {
    installation_id: signed.tenant.installationId,
    agreement_id: signed.agreementId,
    kind: subject.kind,
    subject_github_id: subject.kind === 'email_domain' ? null : subject.githubId,
    subject_domain: subject.kind === 'email_domain' ? subject.domain : null,
    source: 'manager',
    approved_by: signed.person.userId,
    approved_at: at,
  });
}

/** A user approval derived by a rule from `parentId`, approved at `at` and expiring at `expiresAt`. */
export function ruleApprovalAt(
  db: Kysely<Database>,
  signed: Signed,
  rule: { readonly parentId: number; readonly githubId: number; readonly at: Date; readonly expiresAt: Date },
): Promise<number> {
  return insertApprovalRow(db, {
    installation_id: signed.tenant.installationId,
    agreement_id: signed.agreementId,
    kind: 'user',
    subject_github_id: rule.githubId,
    subject_domain: null,
    source: 'rule',
    derived_from_approval_id: rule.parentId,
    approved_at: rule.at,
    expires_at: rule.expiresAt,
  });
}

/** Revokes the approval at the instant `at`, by the signatory of the agreement. */
export async function revokeApprovalAt(
  db: Kysely<Database>,
  signed: Signed,
  approvalId: number,
  at: Date,
): Promise<void> {
  await db
    .updateTable('corporate_approvals')
    .set({ revoked_at: at, revoked_by: signed.person.userId, revoke_reason: 'left the company' })
    .where('id', '=', approvalId)
    .execute();
}

/** Every ISO instant of a file replaced by a marker: a signature is stamped by the clock of the database, which a stored file cannot hold. */
export const withoutInstants = (text: string): string =>
  text.replaceAll(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, '<instant>');

/** Stores `count` approvals by the manager for as many users, one statement, and answers with their ids in the order of the id. */
export async function seedUserApprovals(db: Kysely<Database>, signed: Signed, count: number): Promise<number[]> {
  if (count === 0) {
    return [];
  }
  const rows = await db
    .insertInto('corporate_approvals')
    .values(
      Array.from({ length: count }, (_unused, index) => ({
        installation_id: signed.tenant.installationId,
        agreement_id: signed.agreementId,
        kind: 'user' as const,
        subject_github_id: 20_000 + index,
        subject_domain: null,
        source: 'manager' as const,
        approved_by: signed.person.userId,
      })),
    )
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}
