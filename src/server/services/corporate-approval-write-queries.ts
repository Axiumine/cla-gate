// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { ApprovalKind } from '../../shared/corporate-approvals.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { domainOf, githubIdOf, type StoredSubject } from './corporate-approval-subject.ts';

// The statements that change the approvals of a corporate agreement (E21-S03), over the tables of migration 020. Every statement names the
// installation in its WHERE clause (the insert selects its row from the agreement of the tenant), and the composite foreign keys of the
// migration hold the same line in the database. The caller runs them inside one transaction with the agreement's signature locked, so the
// limit, the uniqueness and the revocation of an agreement are decided one request at a time.

/** An approval of the manager: the agreement, the manager (`users.id`) and the subject. */
export interface ManagerApproval {
  readonly agreementId: number;
  readonly approvedBy: number;
  readonly subject: StoredSubject;
}

/**
 * Appends an approval of source `manager` under the agreement of the tenant, and the login snapshot of an account or organisation
 * (when one is known: the snapshot of a person who was erased is not stored again). The approval row is selected from the agreement with
 * the installation id in the WHERE clause, so an agreement of another tenant selects nothing.
 * @returns the id of the approval.
 * @throws NoResultError when the tenant has no such agreement.
 * @throws the unique violation of `corporate_approvals_active_unique` when the agreement has an approval in force for the subject.
 */
export async function insertManagerApproval(
  db: Kysely<Database>,
  scope: TenantScope,
  approval: ManagerApproval,
): Promise<number> {
  const { subject } = approval;
  const row = await db
    .insertInto('corporate_approvals')
    .columns([
      'installation_id',
      'agreement_id',
      'kind',
      'subject_github_id',
      'subject_domain',
      'source',
      'approved_by',
    ])
    .expression((eb) =>
      eb
        .selectFrom('corporate_agreements as a')
        .select([
          'a.installation_id',
          'a.id as agreement_id',
          eb.cast<ApprovalKind>(eb.val(subject.kind), 'text').as('kind'),
          eb.cast<number | null>(eb.val(githubIdOf(subject)), 'bigint').as('subject_github_id'),
          eb.cast<string | null>(eb.val(domainOf(subject)), 'text').as('subject_domain'),
          eb.cast<'manager'>(eb.val('manager'), 'text').as('source'),
          eb.cast<number>(eb.val(approval.approvedBy), 'bigint').as('approved_by'),
        ])
        .where('a.installation_id', '=', scope.installationId)
        .where('a.id', '=', approval.agreementId),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  if (subject.kind !== 'email_domain' && subject.login !== null) {
    await db.insertInto('corporate_approval_pii').values({ approval_id: row.id, login: subject.login }).execute();
  }
  return row.id;
}
