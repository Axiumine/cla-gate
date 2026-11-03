// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import type { Database } from '../../adapters/db/schema.ts';
import { signerNetworkColumns } from './signer-network-columns.ts';

// The signatures in the export of a person's own data (E16-S06). The person is a data subject and belongs to no tenant, so the
// statement names the person (`users.id`) and no installation: it returns the person's signatures in every tenant on purpose,
// filters on that key and on nothing the caller supplies, and writes nothing.

/**
 * The signatures of the person (`users.id`) with everything the export shows of them, newest first: the installation, the
 * document and the version signed, the repository the person signed from and the personal data still held for the signature
 * (`personal_data`, `null` once it was erased). Who revoked a signature is not selected. The network columns are read when the
 * database has them.
 */
export async function ownSignatures(db: Kysely<Database>, userId: number) {
  const network = await signerNetworkColumns(db);
  const address = network.ipAddress ? sql<string | null>`host(p.ip_address)` : sql<string | null>`null::text`;
  const agent = network.userAgent ? sql<string | null>`p.user_agent` : sql<string | null>`null::text`;
  return db
    .selectFrom('signatures as s')
    .innerJoin('installations as i', 'i.id', 's.installation_id')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 's.document_id').onRef('d.installation_id', '=', 's.installation_id'),
    )
    .innerJoin('cla_versions as v', 'v.id', 's.version_id')
    .leftJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 's.source_repository_id').onRef('r.installation_id', '=', 's.installation_id'),
    )
    .select([
      's.id',
      'i.github_installation_id',
      'i.account_login',
      'd.id as document_id',
      'd.name as document_name',
      'v.id as version_id',
      's.major',
      'v.minor',
      's.content_sha256',
      's.consent_text_id',
      's.signer_type',
      's.signed_at',
      'r.full_name as source_repository',
      's.source_pr_number',
      's.revoked_at',
      's.revoke_reason',
    ])
    .select((eb) =>
      jsonObjectFrom(
        eb
          .selectFrom('signer_pii as p')
          .select(['p.name', 'p.email', 'p.login', address.as('ip_address'), agent.as('user_agent')])
          .whereRef('p.signature_id', '=', 's.id'),
      ).as('personal_data'),
    )
    .where('s.user_id', '=', userId)
    .orderBy('s.signed_at', 'desc')
    .orderBy('s.id', 'desc')
    .execute();
}
