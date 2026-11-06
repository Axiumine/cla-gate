// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';

// What the export of a person's own data reads of the corporate CLA (E21): the agreements the person signed for a company, and the
// approvals that name the person. Like the other statements of the export, they name the person and no installation: a data
// subject belongs to no tenant, so each one returns the person's rows in every tenant on purpose, filters on the person's own key
// and on nothing the caller supplies, and writes nothing. Who approved, who revoked and the text of a reason are not selected:
// the first two are other people, and the third is typed by one.

/**
 * The agreements the person (`users.id`) signed as the authorised signatory of a company, newest first: the installation, the
 * document and the major, when the signature was made and revoked, and the company and title the person gave
 * (`personal_data`, `null` once erased).
 */
export function ownCorporateAgreements(db: Kysely<Database>, userId: number) {
  return db
    .selectFrom('corporate_agreements as a')
    .innerJoin('signatures as s', (join) =>
      join.onRef('s.id', '=', 'a.signature_id').onRef('s.installation_id', '=', 'a.installation_id'),
    )
    .innerJoin('installations as i', 'i.id', 'a.installation_id')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 'a.document_id').onRef('d.installation_id', '=', 'a.installation_id'),
    )
    .select([
      'a.id',
      'a.signature_id',
      'a.major',
      'i.github_installation_id',
      'i.account_login',
      'd.id as document_id',
      'd.name as document_name',
      's.signed_at',
      's.revoked_at',
    ])
    .select((eb) =>
      jsonObjectFrom(
        eb
          .selectFrom('corporate_agreement_pii as p')
          .select(['p.company_name', 'p.signatory_title'])
          .whereRef('p.agreement_id', '=', 'a.id'),
      ).as('personal_data'),
    )
    .where('s.user_id', '=', userId)
    .orderBy('a.id', 'desc')
    .execute();
}

/**
 * The approvals that name the person by their numeric GitHub id (`kind = 'user'`, whoever gave them), newest first: the agreement,
 * its installation, document and major, where the approval came from, when it was given, expires and was revoked, and the login
 * snapshot (`null` once erased). An approval of a domain or of an organisation names no person and is not selected.
 */
export function ownCorporateApprovals(db: Kysely<Database>, githubId: GithubId) {
  return db
    .selectFrom('corporate_approvals as ap')
    .innerJoin('corporate_agreements as a', (join) =>
      join.onRef('a.id', '=', 'ap.agreement_id').onRef('a.installation_id', '=', 'ap.installation_id'),
    )
    .innerJoin('installations as i', 'i.id', 'ap.installation_id')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 'a.document_id').onRef('d.installation_id', '=', 'a.installation_id'),
    )
    .leftJoin('corporate_approval_pii as p', 'p.approval_id', 'ap.id')
    .select([
      'ap.id',
      'ap.agreement_id',
      'ap.source',
      'ap.approved_at',
      'ap.expires_at',
      'ap.revoked_at',
      'a.major',
      'i.github_installation_id',
      'i.account_login',
      'd.id as document_id',
      'd.name as document_name',
      'p.login',
    ])
    .where('ap.kind', '=', 'user')
    .where('ap.subject_github_id', '=', githubId)
    .orderBy('ap.id', 'desc')
    .execute();
}
