// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statements that count the approvals of a corporate agreement and find the ones that cover a domain (E21-S03). Every statement names the
// installation in its WHERE clause. An approval is in force while it is neither revoked nor expired; "now" is the clock of the database.

/** How many approvals of the agreement are in force. */
export async function countActiveApprovals(
  db: Kysely<Database>,
  scope: TenantScope,
  agreementId: number,
): Promise<number> {
  const row = await db
    .selectFrom('corporate_approvals')
    .select(sql<string>`count(*)`.as('n'))
    .where('installation_id', '=', scope.installationId)
    .where('agreement_id', '=', agreementId)
    .where('revoked_at', 'is', null)
    .where((condition) =>
      condition.or([condition('expires_at', 'is', null), condition('expires_at', '>', sql<Date>`now()`)]),
    )
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/**
 * The approval in force that covers a domain: which, under which agreement. Never a name.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export interface DomainApproval {
  readonly approvalId: number;
  readonly agreementId: number;
}

/**
 * The approvals in force of the tenant for exactly `domain` (the stored form), under agreements whose signature is not revoked. The
 * tenant is in the WHERE clause: a domain approved in one tenant covers nobody in another, and neither is a domain that only contains or
 * ends with the approved one. This is the read side of the claim of E21-S04 and of the coverage of E21-S05.
 * @internal Exported for the tests and for E21-S04 (Knip ignores `@internal` exports in production mode).
 */
export function domainApprovals(db: Kysely<Database>, scope: TenantScope, domain: string): Promise<DomainApproval[]> {
  return db
    .selectFrom('corporate_approvals as p')
    .innerJoin('corporate_agreements as a', (join) =>
      join.onRef('a.id', '=', 'p.agreement_id').onRef('a.installation_id', '=', 'p.installation_id'),
    )
    .innerJoin('signatures as s', (join) =>
      join.onRef('s.id', '=', 'a.signature_id').onRef('s.installation_id', '=', 'a.installation_id'),
    )
    .select(['p.id as approvalId', 'p.agreement_id as agreementId'])
    .where('p.installation_id', '=', scope.installationId)
    .where('p.kind', '=', 'email_domain')
    .where('p.subject_domain', '=', domain)
    .where('p.revoked_at', 'is', null)
    .where('s.revoked_at', 'is', null)
    .orderBy('p.id', 'asc')
    .execute();
}
