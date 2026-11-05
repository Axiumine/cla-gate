// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { tenantState } from '../domain/tenant-state.ts';
import {
  type AgreementPageRequest,
  type AgreementPosition,
  type AgreementRow,
  ownAgreementRows,
  tenantAgreementRows,
} from './corporate-agreement-queries.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';

// What the CLA manager and the org admin read of the agreements (E21-S02). The authority of a manager is one fact: they are the
// signatory of the agreement, the person of its signature. It needs no GitHub role and no row besides the signature, so there is
// no separate table of managers to fall out of step. An agreement that is not the caller's is not found, whoever's it is: the
// answer is the one for an id that names nothing.

/** A page of agreements: the rows, and where the next page starts (`null` on the last page). */
export interface AgreementPage {
  readonly items: readonly AgreementRow[];
  readonly next: AgreementPosition | null;
}

/** The rows of a page: `limit` of the `limit + 1` the statement read, and the position of the first one that was left out. */
function pageOf(rows: readonly AgreementRow[], limit: number): AgreementPage {
  const [following] = rows.slice(limit);
  return { items: rows.slice(0, limit), next: following === undefined ? null : { id: following.id } };
}

/** One page of the agreements the person (`users.id`) signed, in every tenant, newest first. Nobody else's is ever in it. */
export async function listOwnAgreements(
  db: Kysely<Database>,
  userId: number,
  request: AgreementPageRequest,
): Promise<AgreementPage> {
  return pageOf(await ownAgreementRows(db, userId, { ...request, agreementId: null }), request.limit);
}

/** One page of the agreements of the tenant, newest first, for an org admin of it. */
export async function listTenantAgreements(
  db: Kysely<Database>,
  scope: TenantScope,
  request: AgreementPageRequest,
): Promise<AgreementPage> {
  return pageOf(await tenantAgreementRows(db, scope, request), request.limit);
}

/**
 * The agreement `agreementId` when the person (`users.id`) is its signatory: its manager. Revoked agreements are found too, so the
 * manager can still read what they signed.
 * @throws CorporateRuleError `not_found` for an agreement that does not exist and for one that is somebody else's, which cannot be told apart.
 */
export async function readOwnAgreement(
  db: Kysely<Database>,
  userId: number,
  agreementId: number,
): Promise<AgreementRow> {
  const [agreement] = await ownAgreementRows(db, userId, { agreementId, limit: 1, from: null });
  if (agreement === undefined) {
    throw new CorporateRuleError('not_found');
  }
  return agreement;
}

/**
 * The agreement of the person for an action that changes something of it (the approvals of E21-S03 are the first): the manager must
 * be its signatory, the tenant must be served, and the agreement must not be revoked. Authority is "signatory of an unrevoked
 * agreement", so a revoked agreement makes every manager mutation a `409 agreement_revoked` and a suspended tenant a
 * `409 installation_suspended`.
 * @internal Exported for the mutations of E21-S03 and for the tests (Knip ignores `@internal` exports in production mode).
 * @throws CorporateRuleError `not_found` (not the caller's, or a tenant that is rejected or uninstalled), `installation_suspended`,
 * `agreement_revoked`.
 */
export async function requireManagedAgreement(
  db: Kysely<Database>,
  userId: number,
  agreementId: number,
): Promise<AgreementRow> {
  const agreement = await readOwnAgreement(db, userId, agreementId);
  const state = tenantState(agreement);
  if (state === 'rejected' || state === 'deleted') {
    throw new CorporateRuleError('not_found');
  }
  if (state === 'suspended') {
    throw new CorporateRuleError('installation_suspended');
  }
  if (agreement.revokedAt !== null) {
    throw new CorporateRuleError('agreement_revoked');
  }
  return agreement;
}
