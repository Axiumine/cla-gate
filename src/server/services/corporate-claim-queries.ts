// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statements behind the claim of an employee under an employer's corporate agreement (E21-S04), over the tables of migration 020. Every
// statement names the installation in its WHERE clause (the insert selects its row from the agreement of the tenant), and the composite
// foreign keys of the migration hold the same line in the database. "In force" means neither revoked nor expired, and "now" is the clock of
// the database. The writes run inside the one transaction of the claim, with the signature of the agreement locked.

/** The agreements of the tenant a claim can be made under: for the corporate document, signed under its major in force, signature not revoked. */
function validAgreements(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly documentId: number; readonly major: number },
) {
  return db
    .selectFrom('corporate_agreements as a')
    .innerJoin('signatures as s', (join) =>
      join.onRef('s.id', '=', 'a.signature_id').onRef('s.installation_id', '=', 'a.installation_id'),
    )
    .where('a.installation_id', '=', scope.installationId)
    .where('a.document_id', '=', at.documentId)
    .where('a.major', '=', at.major)
    .where('s.revoked_at', 'is', null);
}

/** An agreement a claim can be made under, by its id and the id of its signature (what the lock of the agreement takes). */
export interface ClaimAgreement {
  readonly id: number;
  readonly signatureId: number;
}

/**
 * The agreements of the tenant a claim is evaluated against, in ascending id: the ones for the corporate document of the repository that
 * were signed under the major in force and whose signature is not revoked. An agreement of another tenant is never read, and neither is
 * one for another document or an earlier major, which covers nobody under this document's rules.
 */
export async function listValidAgreements(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly documentId: number; readonly major: number },
): Promise<ClaimAgreement[]> {
  return validAgreements(db, scope, at)
    .select(['a.id', 'a.signature_id as signatureId'])
    .orderBy('a.id', 'asc')
    .execute();
}

/** Whether {@link listValidAgreements} would list at least one agreement: the question the availability of the claim answers. */
export async function hasValidAgreement(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly documentId: number; readonly major: number },
): Promise<boolean> {
  const row = await validAgreements(db, scope, at).select('a.id').limit(1).executeTakeFirst();
  return row !== undefined;
}

/** The `user` approval of a person under an agreement that is not revoked, and whether it is still in force or has expired. */
export interface UserApproval {
  readonly id: number;
  readonly inForce: boolean;
}

/**
 * The approval of kind `user` for the numeric GitHub id under the agreement that is not revoked, of whatever source: the manager's own, or
 * one derived by an earlier claim. At most one exists (`corporate_approvals_active_unique`); an expired one is returned with `inForce`
 * false, because it still holds the place of the one the person is about to get.
 */
export async function findUserApproval(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly agreementId: number; readonly githubId: GithubId },
): Promise<UserApproval | null> {
  const row = await db
    .selectFrom('corporate_approvals')
    .select(['id', sql<boolean>`(expires_at is null or expires_at > now())`.as('inForce')])
    .where('installation_id', '=', scope.installationId)
    .where('agreement_id', '=', at.agreementId)
    .where('kind', '=', 'user')
    .where('subject_github_id', '=', at.githubId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return row ?? null;
}

/** Whether the approval `approvalId` of the agreement, of one of the two kinds a rule derives from, is in force. */
export async function isRuleParentInForce(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly agreementId: number; readonly approvalId: number },
): Promise<boolean> {
  const row = await db
    .selectFrom('corporate_approvals')
    .select('id')
    .where('installation_id', '=', scope.installationId)
    .where('agreement_id', '=', at.agreementId)
    .where('id', '=', at.approvalId)
    .where('kind', 'in', ['email_domain', 'github_org'])
    .where('revoked_at', 'is', null)
    .where((condition) =>
      condition.or([condition('expires_at', 'is', null), condition('expires_at', '>', sql<Date>`now()`)]),
    )
    .executeTakeFirst();
  return row !== undefined;
}

/** An organisation the manager approved: the approval, the numeric id of the organisation and the login snapshot (`null` when none is held). */
export interface OrgApproval {
  readonly approvalId: number;
  readonly orgGithubId: GithubId;
  readonly login: string | null;
}

/** The organisation approvals in force of the agreement, in ascending approval id, at most `limit`. */
export async function listOrgApprovals(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly agreementId: number; readonly limit: number },
): Promise<OrgApproval[]> {
  const rows = await db
    .selectFrom('corporate_approvals as p')
    .leftJoin('corporate_approval_pii as pii', 'pii.approval_id', 'p.id')
    .select(['p.id as approvalId', 'p.subject_github_id as orgGithubId', 'pii.login'])
    .where('p.installation_id', '=', scope.installationId)
    .where('p.agreement_id', '=', at.agreementId)
    .where('p.kind', '=', 'github_org')
    .where('p.revoked_at', 'is', null)
    .where((condition) =>
      condition.or([condition('p.expires_at', 'is', null), condition('p.expires_at', '>', sql<Date>`now()`)]),
    )
    .orderBy('p.id', 'asc')
    .limit(at.limit)
    .execute();
  return rows.map((row) => ({
    approvalId: row.approvalId,
    orgGithubId: parseGithubId(row.orgGithubId),
    login: row.login,
  }));
}

/** The approval a rule derives for a person: the agreement, the approval of the domain or organisation it derives from, the person and for how long. */
export interface DerivedApproval {
  readonly agreementId: number;
  readonly parentId: number;
  readonly githubId: GithubId;
  /** The login snapshot of the person (display only, erasable), kept in its own table. */
  readonly login: string;
  readonly lifetimeDays: number;
}

/**
 * Appends an approval of source `rule` and kind `user` for the person, under the agreement of the tenant, derived from the approval of a
 * domain or an organisation, expiring `lifetimeDays` days after the database's now. The row is selected from the agreement with the
 * installation id in the WHERE clause, so an agreement of another tenant selects nothing; the login snapshot goes to its own erasable table.
 * @returns the id of the approval.
 * @throws NoResultError when the tenant has no such agreement.
 * @throws the unique violation of `corporate_approvals_active_unique` when the person has an approval that is not revoked yet.
 */
export async function insertDerivedApproval(
  db: Kysely<Database>,
  scope: TenantScope,
  approval: DerivedApproval,
): Promise<number> {
  const row = await db
    .insertInto('corporate_approvals')
    .columns([
      'installation_id',
      'agreement_id',
      'kind',
      'subject_github_id',
      'subject_domain',
      'source',
      'derived_from_approval_id',
      'expires_at',
    ])
    .expression((eb) =>
      eb
        .selectFrom('corporate_agreements as a')
        .select([
          'a.installation_id',
          'a.id as agreement_id',
          eb.cast<'user'>(eb.val('user'), 'text').as('kind'),
          eb.cast<number>(eb.val(approval.githubId), 'bigint').as('subject_github_id'),
          eb.cast<string | null>(eb.val(null), 'text').as('subject_domain'),
          eb.cast<'rule'>(eb.val('rule'), 'text').as('source'),
          eb.cast<number>(eb.val(approval.parentId), 'bigint').as('derived_from_approval_id'),
          sql<Date>`now() + make_interval(days => ${approval.lifetimeDays})`.as('expires_at'),
        ])
        .where('a.installation_id', '=', scope.installationId)
        .where('a.id', '=', approval.agreementId),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  await db.insertInto('corporate_approval_pii').values({ approval_id: row.id, login: approval.login }).execute();
  return row.id;
}

/** A repository of the tenant that enforces the corporate document, by the key of its row. */
export async function listCorporateRepositoryIds(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<number[]> {
  const rows = await db
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', scope.installationId)
    .where('corporate_document_id', '=', documentId)
    .where('enabled', '=', true)
    .where('removed_at', 'is', null)
    .orderBy('id', 'asc')
    .execute();
  return rows.map((row) => row.id);
}
