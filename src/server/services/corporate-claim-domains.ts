// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { domainApprovals } from './corporate-approval-coverage-queries.ts';

// The domain rule of the claim of an employee (E21-S04), split from `corporate-claim-match.ts`, which keeps the order in which the rules are tried.

/**
 * For each agreement, the lowest id of the approvals in force of a domain the claimant has a verified address in. The comparison is the
 * exact equality of the stored form, in the tenant's own rows (`domainApprovals`): `evilacme.com` and `acme.com.evil.test` are not `acme.com`.
 */
export async function domainParents(
  db: Kysely<Database>,
  scope: TenantScope,
  domains: readonly string[],
): Promise<Map<number, number>> {
  const found = await Promise.all(domains.map((domain) => domainApprovals(db, scope, domain)));
  const parents = new Map<number, number>();
  for (const { approvalId, agreementId } of found.flat()) {
    const known = parents.get(agreementId);
    if (known === undefined || approvalId < known) {
      parents.set(agreementId, approvalId);
    }
  }
  return parents;
}
