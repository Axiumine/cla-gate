// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, NoResultError } from 'kysely';
import { parseGithubId } from '../../../../shared/github-id.ts';
import {
  findUserApproval,
  hasValidAgreement,
  insertDerivedApproval,
  isRuleParentInForce,
  listCorporateRepositoryIds,
  listOrgApprovals,
  listValidAgreements,
} from '../../../services/corporate-claim-queries.ts';
import { PEOPLE } from '../corporate-fixture/test-support.ts';
import type { Database } from '../schema.ts';
import {
  agreementOf,
  arrangeFull,
  corporateDocumentOf,
  domainApprovalOf,
  ownersOfAgreements,
  ownersOfApprovals,
  scoped,
} from '../tenant-corporate-fixture/test-support.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { ownersOfRepositories } from '../tenant-owners/test-support.ts';
import type { TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements behind the claim of an employee (E21-S04): which agreements a claim is evaluated against,
// the approvals a rule reads (the person's own, the organisations', the parent of a derived one), the insert of the derived approval, and the
// repositories the re-evaluation after a claim reaches. Each entry arranges, for both tenants, a corporate document that is in force, the
// agreement of the tenant's signer and approvals of every kind (`arrangeFull`), so that a call with the tenant's own ids finds rows.

/** The files of the claim that run a statement over a tenant table, which the registry spreads in. */
export const E21_CLAIM_TENANT_MODULES = ['services/corporate-claim-queries.ts'] as const;

/** The major `publishCorporateDocument` gives the corporate document of every tenant. */
const MAJOR = 1;

/** True for the error of a statement that selected no row of the tenant where the caller has just read one. */
const isNoResult = (error: unknown): boolean => error instanceof NoResultError;

/** The owners of the rows a call answered with; none when it answered with none, since a lookup over an empty list is no SQL. */
async function ownersIfAny(
  ids: readonly number[],
  ownersOf: (ids: readonly number[]) => Promise<number[]>,
): Promise<number[]> {
  return ids.length === 0 ? [] : ownersOf(ids);
}

/** The corporate document of the tenant and the major in force, which a claim is evaluated against. */
async function documentAt(db: Kysely<Database>, ids: TenantWorld) {
  const { documentId } = await corporateDocumentOf(db, ids);
  return { documentId, major: MAJOR };
}

/** Gives each tenant what {@link arrangeFull} gives, and makes its repositories enforce the corporate document, as a claim finds them. */
async function arrangeRepositories(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  await arrangeFull(db, tenants);
  for (const tenant of tenants) {
    const { documentId } = await corporateDocumentOf(db, tenant);
    await db
      .updateTable('repositories')
      .set({ corporate_document_id: documentId, enabled: true })
      .where('installation_id', '=', tenant.installationId)
      .execute();
  }
}

/** Every function of the claim that runs over a tenant table, by module and name. */
export const E21_CLAIM_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/corporate-claim-queries.ts': {
    listValidAgreements: scoped({
      takesIds: true,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope, ids) => {
        const rows = await listValidAgreements(db, scope, await documentAt(db, ids));
        return ownersIfAny(
          rows.map((row) => row.id),
          (found) => ownersOfAgreements(db, found),
        );
      },
    }),
    hasValidAgreement: scoped({
      takesIds: true,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope, ids) =>
        (await hasValidAgreement(db, scope, await documentAt(db, ids)))
          ? ownersOfAgreements(db, [await agreementOf(db, ids)])
          : [],
    }),
    findUserApproval: scoped({
      takesIds: true,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope, ids) => {
        const found = await findUserApproval(db, scope, {
          agreementId: await agreementOf(db, ids),
          githubId: parseGithubId(PEOPLE.employee),
        });
        return found === null ? [] : ownersOfApprovals(db, [found.id]);
      },
    }),
    isRuleParentInForce: scoped({
      takesIds: true,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope, ids) => {
        const approvalId = await domainApprovalOf(db, ids);
        const inForce = await isRuleParentInForce(db, scope, { agreementId: await agreementOf(db, ids), approvalId });
        return inForce ? ownersOfApprovals(db, [approvalId]) : [];
      },
    }),
    listOrgApprovals: scoped({
      takesIds: true,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope, ids) => {
        const rows = await listOrgApprovals(db, scope, { agreementId: await agreementOf(db, ids), limit: 10 });
        return ownersOfApprovals(
          db,
          rows.map((row) => row.approvalId),
        );
      },
    }),
    insertDerivedApproval: scoped({
      takesIds: true,
      activeOnly: false,
      // The agreement of another tenant selects no row to insert from, which the caller (who has just read its own) never meets.
      refusal: isNoResult,
      arrange: arrangeFull,
      run: async (db, scope, ids) =>
        ownersOfApprovals(db, [
          await insertDerivedApproval(db, scope, {
            agreementId: await agreementOf(db, ids),
            parentId: await domainApprovalOf(db, ids),
            githubId: parseGithubId(8801),
            login: 'registry-derived',
            lifetimeDays: 365,
          }),
        ]),
    }),
    listCorporateRepositoryIds: scoped({
      takesIds: true,
      activeOnly: true,
      arrange: arrangeRepositories,
      run: async (db, scope, ids) =>
        ownersIfAny(await listCorporateRepositoryIds(db, scope, (await documentAt(db, ids)).documentId), (found) =>
          ownersOfRepositories(db, found),
        ),
    }),
  },
};
