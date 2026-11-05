// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import type { KeysetPage } from './signature-queries.ts';

// What the exports of the corporate agreements and approvals read (E21-S05). Every statement names the installation of the scope, so the agreements and
// approvals of another tenant are never read, and each pages by keyset on the id, as the signature export does. Nothing here writes. The personal data of
// the agreements (the company, the login of the signatory) comes from the tables that erasure empties, through left joins: once erased, the cells are `null`.

/**
 * The agreements of the tenant that `page` asks for (at most `page.limit`, all with an id above `page.afterId`), in the order of the id: the agreement, when its
 * signature was made, the major, the company, the signatory by numeric id and by the login snapshot, and whether the signature was revoked.
 */
export function agreementExportBatch(db: Kysely<Database>, scope: TenantScope, page: KeysetPage) {
  return db
    .selectFrom('corporate_agreements as a')
    .innerJoin('signatures as s', (join) =>
      join.onRef('s.id', '=', 'a.signature_id').onRef('s.installation_id', '=', 'a.installation_id'),
    )
    .innerJoin('users as u', 'u.id', 's.user_id')
    .leftJoin('corporate_agreement_pii as p', 'p.agreement_id', 'a.id')
    .leftJoin('signer_pii as sp', 'sp.signature_id', 's.id')
    .select((eb) => [
      'a.id as agreementId',
      's.signed_at as signedAt',
      'a.major',
      'p.company_name as companyName',
      'u.github_id as signatoryGithubId',
      'sp.login as signatoryLogin',
      eb('s.revoked_at', 'is not', null).as('revoked'),
    ])
    .where('a.installation_id', '=', scope.installationId)
    .where('a.id', '>', page.afterId)
    .orderBy('a.id')
    .limit(page.limit)
    .execute();
}

/** One row of {@link agreementExportBatch}. */
export type AgreementExportRow = Awaited<ReturnType<typeof agreementExportBatch>>[number];

/**
 * The approvals of every agreement of the tenant that `page` asks for, in the order of the id: kind, subject (a numeric id or a domain), source and the four
 * instants. The login snapshot of an account is not read: the id is the identity and the login is erasable.
 */
export function approvalExportBatch(db: Kysely<Database>, scope: TenantScope, page: KeysetPage) {
  return db
    .selectFrom('corporate_approvals as p')
    .select([
      'p.id as approvalId',
      'p.agreement_id as agreementId',
      'p.kind',
      'p.subject_github_id as subjectGithubId',
      'p.subject_domain as subjectDomain',
      'p.source',
      'p.approved_at as approvedAt',
      'p.expires_at as expiresAt',
      'p.revoked_at as revokedAt',
    ])
    .where('p.installation_id', '=', scope.installationId)
    .where('p.id', '>', page.afterId)
    .orderBy('p.id')
    .limit(page.limit)
    .execute();
}

/** One row of {@link approvalExportBatch}. */
export type ApprovalExportRow = Awaited<ReturnType<typeof approvalExportBatch>>[number];
