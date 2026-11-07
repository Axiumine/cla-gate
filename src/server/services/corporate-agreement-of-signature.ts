// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The one statement that asks whether a signature is the consent of a corporate agreement (E21-S05), for the re-evaluation that follows its
// revocation (E15-S03): the pull requests that rested on the agreement's approvals are the ones to evaluate again, and they are found by the
// agreement. It names the installation in its WHERE clause, so a signature of another tenant has no agreement here.

/**
 * The id of the corporate agreement whose consent is the signature `signatureId` of the tenant, or `null` when it is the signature of an
 * individual (or of another tenant). An agreement has exactly one signature and a signature at most one agreement (`signature_id` is unique).
 */
export async function findAgreementOfSignature(
  db: Kysely<Database>,
  scope: TenantScope,
  signatureId: number,
): Promise<number | null> {
  const row = await db
    .selectFrom('corporate_agreements')
    .select('id')
    .where('installation_id', '=', scope.installationId)
    .where('signature_id', '=', signatureId)
    .executeTakeFirst();
  return row?.id ?? null;
}
