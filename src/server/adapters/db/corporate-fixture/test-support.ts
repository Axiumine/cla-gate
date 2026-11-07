// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect } from 'vitest';
import { z } from 'zod';
import type { Database } from '../schema.ts';
import { publishVersion, sha256, type Tenant } from '../test-support.ts';

// The rows of the corporate CLA schema (migration 020, E21-S01) that the database tests build on: a tenant's corporate document,
// a signatory with the corporate signature that is their consent, an agreement with the erasable text it holds, and approvals of
// the three kinds. Nothing here is the application's code: the routes that write these rows are E21-S02 and later.

const CORPORATE_TEXT = 'Corporate terms of the project, as the maintainers wrote them for the tests.';
const A_DAY = 86_400_000;
const insertedId = z.object({ id: z.number() });

/** `expect.any(Date)` is typed `any`; as `unknown` it can sit in an object literal. */
export const anyDate: unknown = expect.any(Date);

/** A corporate document of a tenant with its active version 1.0. */
export interface CorporateDocument {
  readonly documentId: number;
  readonly versionId: number;
  readonly major: number;
  readonly contentSha256: string;
}

/** A stored person: `users.id` and the numeric GitHub id. */
export interface Person {
  readonly userId: number;
  readonly githubId: number;
}

/** Publishes a corporate document (kind `corporate`) for the tenant and activates its version 1.0. */
export async function publishCorporateDocument(db: Kysely<Database>, tenant: Tenant): Promise<CorporateDocument> {
  const document = await db
    .insertInto('cla_documents')
    .values({
      installation_id: tenant.installationId,
      repository_id: null,
      name: 'Corporate CLA',
      kind: 'corporate',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await publishVersion(db, document.id, tenant.publisherId, {
    major: 1,
    minor: 0,
    text: CORPORATE_TEXT,
  });
  await db.updateTable('cla_documents').set({ active_version_id: version.id }).where('id', '=', document.id).execute();
  return {
    documentId: document.id,
    versionId: version.id,
    major: 1,
    contentSha256: sha256(CORPORATE_TEXT),
  };
}

/** The user with this GitHub id, stored when there is none yet (a person can sign in two tenants). */
export async function personWithId(db: Kysely<Database>, githubId: number): Promise<Person> {
  const existing = await db.selectFrom('users').select('id').where('github_id', '=', githubId).executeTakeFirst();
  if (existing !== undefined) {
    return { userId: existing.id, githubId };
  }
  const created = await db
    .insertInto('users')
    .values({ github_id: githubId, login: `login-${githubId}`, name: `Name ${githubId}`, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { userId: created.id, githubId };
}

/** The consent of a signatory: a signature of the corporate version by the person, with the personal data held for it. */
export async function signCorporate(
  db: Kysely<Database>,
  tenant: Tenant,
  document: CorporateDocument,
  person: Person,
): Promise<number> {
  const signature = await db
    .insertInto('signatures')
    .values({
      installation_id: tenant.installationId,
      user_id: person.userId,
      document_id: document.documentId,
      version_id: document.versionId,
      major: document.major,
      content_sha256: document.contentSha256,
      consent_text_id: 'consent-corporate-v1',
      signer_type: 'corporate',
      source_repository_id: tenant.repositoryId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('signer_pii')
    .values({
      signature_id: signature.id,
      user_id: person.userId,
      name: `Name ${person.githubId}`,
      email: `u${person.githubId}@example.test`,
      login: `login-${person.githubId}`,
    })
    .execute();
  return signature.id;
}

/** The text an agreement holds for the company and its signatory. */
export interface AgreementText {
  readonly companyName: string;
  readonly signatoryTitle: string;
}

const ACME: AgreementText = { companyName: 'Acme Corp', signatoryTitle: 'Chief Legal Officer' };

/** An agreement row for a signature, without the erasable text. */
export async function insertAgreement(
  db: Kysely<Database>,
  tenant: Tenant,
  document: CorporateDocument,
  signatureId: number,
): Promise<number> {
  const agreement = await db
    .insertInto('corporate_agreements')
    .values({
      installation_id: tenant.installationId,
      signature_id: signatureId,
      document_id: document.documentId,
      major: document.major,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return agreement.id;
}

/** The erasable text of an agreement. */
export async function storeAgreementText(
  db: Kysely<Database>,
  agreementId: number,
  text: AgreementText = ACME,
): Promise<void> {
  await db
    .insertInto('corporate_agreement_pii')
    .values({ agreement_id: agreementId, company_name: text.companyName, signatory_title: text.signatoryTitle })
    .execute();
}

/** A tenant and its corporate document: what a person signs a corporate agreement under. */
export interface Corporation {
  readonly tenant: Tenant;
  readonly document: CorporateDocument;
}

/** A signatory, the agreement they signed for the company, and the text it holds. */
export interface Signed {
  readonly tenant: Tenant;
  readonly person: Person;
  readonly signatureId: number;
  readonly agreementId: number;
}

/** The person signs the corporate document for a company: the signature, its personal data, the agreement and its text. */
export async function signAgreement(
  db: Kysely<Database>,
  { tenant, document }: Corporation,
  person: Person,
  text: AgreementText = ACME,
): Promise<Signed> {
  const signatureId = await signCorporate(db, tenant, document, person);
  const agreementId = await insertAgreement(db, tenant, document, signatureId);
  await storeAgreementText(db, agreementId, text);
  return { tenant, person, signatureId, agreementId };
}

/** What an approval is about: an account (a user or an org, by numeric id and with its login snapshot) or a domain. */
export type Subject =
  | { readonly kind: 'user' | 'github_org'; readonly githubId: number; readonly login: string }
  | { readonly kind: 'email_domain'; readonly domain: string };

/** The columns of an approval made by the manager, who is the signatory, as the database stores them, before any override. */
function managerRow(signed: Signed, subject: Subject) {
  return {
    installation_id: signed.tenant.installationId,
    agreement_id: signed.agreementId,
    kind: subject.kind,
    subject_github_id: subject.kind === 'email_domain' ? null : subject.githubId,
    subject_domain: subject.kind === 'email_domain' ? subject.domain : null,
    source: 'manager',
    approved_by: signed.person.userId,
  };
}

/** Stores the login snapshot of an approval of an account. A domain has none. */
async function storeLogin(db: Kysely<Database>, approvalId: number, subject: Subject): Promise<void> {
  if (subject.kind !== 'email_domain') {
    await db.insertInto('corporate_approval_pii').values({ approval_id: approvalId, login: subject.login }).execute();
  }
}

/** An approval by the manager (the signatory) of a user, an org or a domain, with the login snapshot of an account. */
export async function approve(db: Kysely<Database>, signed: Signed, subject: Subject): Promise<number> {
  const approvalId = await insertApprovalRow(db, managerRow(signed, subject));
  await storeLogin(db, approvalId, subject);
  return approvalId;
}

/** A user approval derived from the domain or org approval `parentId`, valid for 365 days, with the login snapshot. */
export async function derive(
  db: Kysely<Database>,
  signed: Signed,
  parentId: number,
  employee: { readonly githubId: number; readonly login: string },
): Promise<number> {
  const approvalId = await insertApprovalRow(db, {
    installation_id: signed.tenant.installationId,
    agreement_id: signed.agreementId,
    kind: 'user',
    subject_github_id: employee.githubId,
    subject_domain: null,
    source: 'rule',
    derived_from_approval_id: parentId,
    expires_at: new Date(Date.now() + 365 * A_DAY),
  });
  await storeLogin(db, approvalId, { kind: 'user', ...employee });
  return approvalId;
}

/** An approval row from the columns given, whatever they hold: the database decides whether it is valid. */
export async function insertApprovalRow(db: Kysely<Database>, row: Readonly<Record<string, unknown>>): Promise<number> {
  const entries = Object.entries(row);
  const { rows } = await sql`
    insert into corporate_approvals (${sql.join(entries.map(([column]) => sql.ref(column)))})
    values (${sql.join(entries.map(([, value]) => sql.val(value)))}) returning id`.execute(db);
  return insertedId.parse(rows[0]).id;
}

/** A tenant with a corporate document, its signatory's agreement and the manager approvals of every kind. */
export interface CorporateTenant extends Corporation {
  readonly signed: Signed;
  /** The signatory's own approval (a user approval by the manager, who is the signatory). */
  readonly ownApproval: number;
  readonly domainApproval: number;
  readonly orgApproval: number;
  /** A user approval by the manager, for a person who never signed in. */
  readonly employeeApproval: number;
  /** A user approval derived from the domain approval. */
  readonly derivedApproval: number;
}

/** The numeric ids of the people and the org of {@link corporateTenant}, which every tenant shares. */
export const PEOPLE = { employee: 7001, derivedEmployee: 7002, org: 9100 } as const;

/** The domain approved in {@link corporateTenant}. */
export const DOMAIN = 'acme.example';

/** Gives an existing tenant a corporate document and an agreement signed by `signatoryGithubId`, with one approval of each kind. */
export async function corporateTenant(
  db: Kysely<Database>,
  tenant: Tenant,
  signatoryGithubId: number,
  text: AgreementText = ACME,
): Promise<CorporateTenant> {
  const document = await publishCorporateDocument(db, tenant);
  const person = await personWithId(db, signatoryGithubId);
  const signed = await signAgreement(db, { tenant, document }, person, text);
  const ownApproval = await approve(db, signed, {
    kind: 'user',
    githubId: person.githubId,
    login: `login-${person.githubId}`,
  });
  const domainApproval = await approve(db, signed, { kind: 'email_domain', domain: DOMAIN });
  const orgApproval = await approve(db, signed, { kind: 'github_org', githubId: PEOPLE.org, login: 'acme-org' });
  const employeeApproval = await approve(db, signed, {
    kind: 'user',
    githubId: PEOPLE.employee,
    login: 'employee-login',
  });
  const derivedApproval = await derive(db, signed, domainApproval, {
    githubId: PEOPLE.derivedEmployee,
    login: 'derived-login',
  });
  return { tenant, document, signed, ownApproval, domainApproval, orgApproval, employeeApproval, derivedApproval };
}

/** The columns of a manager approval row to start from in a test that spoils one of them: a user approval of `githubId`. */
export function validUserRow(corporate: CorporateTenant, githubId: number): Record<string, unknown> {
  return managerRow(corporate.signed, { kind: 'user', githubId, login: 'unused' });
}

/** A date `days` from now, negative for the past. */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * A_DAY);
}
