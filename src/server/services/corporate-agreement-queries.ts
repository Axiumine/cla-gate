// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { whenPresent } from './when-present.ts';

// The statements behind corporate signing (E21-S02) over the tables of migration 020. The writes are called inside the one transaction
// of the signing; each selects its row from the parent with the installation id in the WHERE clause, so a signature or an agreement
// of another tenant is never written to, and the composite foreign keys of the migration hold the same line in the database. The reads
// are of two kinds: the agreements of one person, in every tenant (the signatory is a person and belongs to no tenant, as for the
// list of the own signatures), and the agreements of one tenant for its org admins. `corporate_agreements` is insert-only (triggers),
// and the text of a company and the logins live in tables of their own that erasure can empty.

/** The columns every list of agreements reads, from the agreement, its signature, its text and the installation. */
function agreementRows(db: Kysely<Database>) {
  return db
    .selectFrom('corporate_agreements as a')
    .innerJoin('signatures as s', (join) =>
      join.onRef('s.id', '=', 'a.signature_id').onRef('s.installation_id', '=', 'a.installation_id'),
    )
    .innerJoin('users as u', 'u.id', 's.user_id')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 'a.document_id').onRef('d.installation_id', '=', 'a.installation_id'),
    )
    .innerJoin('installations as i', 'i.id', 'a.installation_id')
    .leftJoin('corporate_agreement_pii as p', 'p.agreement_id', 'a.id')
    .leftJoin('signer_pii as sp', 'sp.signature_id', 's.id')
    .select((eb) => [
      'a.id',
      'a.signature_id as signatureId',
      'a.major',
      's.signed_at as signedAt',
      's.revoked_at as revokedAt',
      'p.company_name as companyName',
      'p.signatory_title as signatoryTitle',
      'd.id as documentId',
      'd.name as documentName',
      'u.github_id as signatoryGithubId',
      'sp.login as signatoryLogin',
      'i.account_login as accountLogin',
      'i.admission_status as admissionStatus',
      'i.suspended_at as suspendedAt',
      'i.deleted_at as deletedAt',
      eb
        .selectFrom('corporate_approvals as ap')
        .select(sql<string>`count(*)`.as('n'))
        .whereRef('ap.agreement_id', '=', 'a.id')
        .whereRef('ap.installation_id', '=', 'a.installation_id')
        .where('ap.revoked_at', 'is', null)
        .where((condition) =>
          condition.or([condition('ap.expires_at', 'is', null), condition('ap.expires_at', '>', sql<Date>`now()`)]),
        )
        .as('activeApprovals'),
    ]);
}

/** An agreement as the lists read it, with the state of its installation (so a caller can tell a suspended tenant from a served one). */
export interface AgreementRow {
  readonly id: number;
  readonly signatureId: number;
  readonly major: number;
  readonly signedAt: Date;
  /** Set once the signature of the agreement was revoked: the agreement is revoked with it. */
  readonly revokedAt: Date | null;
  /** The erasable text; `null` once the signatory was erased. */
  readonly companyName: string | null;
  readonly signatoryTitle: string | null;
  readonly documentId: number;
  readonly documentName: string;
  readonly signatoryGithubId: GithubId;
  /** The login snapshot of the signatory; `null` once erased. */
  readonly signatoryLogin: string | null;
  readonly accountLogin: string;
  readonly admissionStatus: 'admitted' | 'rejected';
  readonly suspendedAt: Date | null;
  readonly deletedAt: Date | null;
  /** The approvals that are neither revoked nor expired. */
  readonly activeApprovals: number;
}

/** The newest agreement a page starts at (that one included): a list is ordered by the id of the agreement, newest first. */
export interface AgreementPosition {
  readonly id: number;
}

/** A page asked for: how many rows, and the agreement at which to start (`null` for the first page). */
export interface AgreementPageRequest {
  readonly limit: number;
  readonly from: AgreementPosition | null;
}

/** The rows of one page of a list: one more than the limit, from the position, newest first, the count being the number the database counted. */
async function pageOf(
  select: ReturnType<typeof agreementRows>,
  request: AgreementPageRequest,
): Promise<AgreementRow[]> {
  const rows = await whenPresent(select, request.from, (query, from) => query.where('a.id', '<=', from.id))
    .orderBy('a.id', 'desc')
    .limit(request.limit + 1)
    .execute();
  return rows.map((row) => ({
    ...row,
    signatoryGithubId: parseGithubId(row.signatoryGithubId),
    activeApprovals: Number(row.activeApprovals),
  }));
}

/**
 * One more row than `limit` of the agreements the person (`users.id`) signed, in every tenant, newest first, from `request.from`
 * (the extra row, when there is one, tells the caller that a page follows). With `agreementId` the list is that agreement alone, and
 * empty when it is not the person's, whoever's it is or whether it exists: the caller answers both the same. The person is whoever the
 * session names; the statement filters on that key and on nothing else the caller supplies.
 */
export async function ownAgreementRows(
  db: Kysely<Database>,
  userId: number,
  request: AgreementPageRequest & { readonly agreementId: number | null },
): Promise<AgreementRow[]> {
  const own = agreementRows(db).where('s.user_id', '=', userId);
  return pageOf(
    whenPresent(own, request.agreementId, (query, agreementId) => query.where('a.id', '=', agreementId)),
    request,
  );
}

/**
 * One more row than `limit` of the agreements of the tenant, newest first, from `request.from`. The installation is in the WHERE
 * clause of the statement, so the agreements of another tenant are never read.
 */
export async function tenantAgreementRows(
  db: Kysely<Database>,
  scope: TenantScope,
  request: AgreementPageRequest,
): Promise<AgreementRow[]> {
  return pageOf(agreementRows(db).where('a.installation_id', '=', scope.installationId), request);
}

/**
 * Appends the agreement for a corporate signature of the tenant, copying the document and the major from the signature row (the
 * trigger of the migration holds them equal to it). A signature of another tenant, or one that is not corporate, selects no row.
 * @returns the id of the new agreement.
 * @throws NoResultError when the tenant has no such corporate signature (the caller has just written it, so this is a defect).
 */
export async function insertAgreement(db: Kysely<Database>, scope: TenantScope, signatureId: number): Promise<number> {
  const row = await db
    .insertInto('corporate_agreements')
    .columns(['installation_id', 'signature_id', 'document_id', 'major'])
    .expression((eb) =>
      eb
        .selectFrom('signatures as s')
        .select(['s.installation_id', 's.id as signature_id', 's.document_id', 's.major'])
        .where('s.installation_id', '=', scope.installationId)
        .where('s.id', '=', signatureId)
        .where('s.signer_type', '=', 'corporate'),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The erasable text of an agreement: the company name and the title, as cleaned. */
export interface AgreementText {
  readonly agreementId: number;
  readonly companyName: string;
  readonly signatoryTitle: string;
}

/**
 * Stores the text of an agreement of the tenant; the row is selected from the agreement with the installation id in the WHERE clause.
 * @throws NoResultError when the tenant has no such agreement (the caller has just written it, so this is a defect).
 */
export async function insertAgreementText(
  db: Kysely<Database>,
  scope: TenantScope,
  text: AgreementText,
): Promise<void> {
  await db
    .insertInto('corporate_agreement_pii')
    .columns(['agreement_id', 'company_name', 'signatory_title'])
    .expression((eb) =>
      eb
        .selectFrom('corporate_agreements as a')
        .select([
          'a.id as agreement_id',
          eb.cast<string>(eb.val(text.companyName), 'text').as('company_name'),
          eb.cast<string>(eb.val(text.signatoryTitle), 'text').as('signatory_title'),
        ])
        .where('a.installation_id', '=', scope.installationId)
        .where('a.id', '=', text.agreementId),
    )
    .returning('agreement_id')
    .executeTakeFirstOrThrow();
}

/** The signatory covered by their own agreement: the agreement, the person by `users.id` and the numeric GitHub id, and the login snapshot. */
export interface SignatoryApproval {
  readonly agreementId: number;
  readonly userId: number;
  readonly githubId: GithubId;
  readonly login: string;
}

/**
 * Approves the signatory personally under the agreement of the tenant: a `user` approval of source `manager`, approved by the
 * signatory, with the login snapshot in its own table. The approval row is selected from the agreement with the installation id in
 * the WHERE clause.
 * @returns the id of the approval.
 * @throws NoResultError when the tenant has no such agreement (the caller has just written it, so this is a defect).
 */
export async function insertSignatoryApproval(
  db: Kysely<Database>,
  scope: TenantScope,
  approval: SignatoryApproval,
): Promise<number> {
  const row = await db
    .insertInto('corporate_approvals')
    .columns(['installation_id', 'agreement_id', 'kind', 'subject_github_id', 'source', 'approved_by'])
    .expression((eb) =>
      eb
        .selectFrom('corporate_agreements as a')
        .select([
          'a.installation_id',
          'a.id as agreement_id',
          eb.cast<'user'>(eb.val('user'), 'text').as('kind'),
          eb.cast<number>(eb.val(approval.githubId), 'bigint').as('subject_github_id'),
          eb.cast<'manager'>(eb.val('manager'), 'text').as('source'),
          eb.cast<number>(eb.val(approval.userId), 'bigint').as('approved_by'),
        ])
        .where('a.installation_id', '=', scope.installationId)
        .where('a.id', '=', approval.agreementId),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  await db.insertInto('corporate_approval_pii').values({ approval_id: row.id, login: approval.login }).execute();
  return row.id;
}
