// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, NoResultError } from 'kysely';
import {
  insertAgreement,
  insertAgreementText,
  insertSignatoryApproval,
  ownAgreementRows,
  tenantAgreementRows,
} from '../../../services/corporate-agreement-queries.ts';
import {
  findCorporateChoice,
  findCorporateSetting,
  lockCorporateRepository,
  setCorporateDocument,
} from '../../../services/corporate-repository-queries.ts';
import {
  corporateTenant,
  insertAgreement as insertAgreementRow,
  personWithId,
  publishCorporateDocument,
  signCorporate,
  storeAgreementText,
} from '../corporate-fixture/test-support.ts';
import type { Database } from '../schema.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { ownersOfDocuments, ownersOfRepositories } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements behind corporate signing (E21-S02): the agreements a person or a tenant reads, the
// three inserts of a signing (agreement, its text, the approval of the signatory), and the corporate document of a repository. The
// seed stores no corporate row, so each entry arranges the stage it needs for both tenants: a corporate document, a corporate signature
// of the tenant's signer, an agreement for it, its text, or all of them with the approvals of every kind (`corporateTenant`).

/** The files of epic E21 that run a statement over a tenant table, which the registry spreads in (the file of the registry is at its size cap). */
export const E21_TENANT_MODULES = [
  'services/corporate-agreement-queries.ts',
  'services/corporate-repository-queries.ts',
] as const;

/** How far an arranged tenant goes, in order: a corporate document, the consent of its signer, the agreement, its text. */
const STAGES = ['document', 'signature', 'agreement', 'text'] as const;

type Stage = (typeof STAGES)[number];

/** True for the error of a statement that selected no row of the tenant where the caller has just written or read one. */
const isNoResult = (error: unknown): boolean => error instanceof NoResultError;

/** Gives the tenant a corporate document, and the rest of the story up to the stage numbered `reach`, for its own signer. */
async function arrangeOne(db: Kysely<Database>, tenant: TenantWorld, reach: number): Promise<void> {
  const document = await publishCorporateDocument(db, tenant);
  if (reach < 1) {
    return;
  }
  const person = await personWithId(db, tenant.signer.githubId);
  const signatureId = await signCorporate(db, tenant, document, person);
  if (reach < 2) {
    return;
  }
  const agreementId = await insertAgreementRow(db, tenant, document, signatureId);
  if (reach >= 3) {
    await storeAgreementText(db, agreementId);
  }
}

/** Gives each tenant a corporate document, and the rest of the story up to `stage`, for its own signer. */
export function arrangeTo(stage: Stage): NonNullable<ScopedQuery['arrange']> {
  return async (db, tenants) => {
    for (const tenant of tenants) {
      await arrangeOne(db, tenant, STAGES.indexOf(stage));
    }
  };
}

/** Gives each tenant a corporate agreement of its own signer with the text and an approval of every kind. */
async function arrangeFull(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  for (const tenant of tenants) {
    await corporateTenant(db, tenant, tenant.signer.githubId);
  }
}

/** The corporate document of the tenant and its active version (the join leaves out a document that has none). */
export function corporateDocumentOf(db: Kysely<Database>, ids: TenantWorld) {
  return db
    .selectFrom('cla_documents as d')
    .innerJoin('cla_versions as v', 'v.id', 'd.active_version_id')
    .select(['d.id as documentId', 'v.id as versionId'])
    .where('d.installation_id', '=', ids.installationId)
    .where('d.kind', '=', 'corporate')
    .executeTakeFirstOrThrow();
}

/** The installation that owns each agreement with these row ids. */
async function ownersOfAgreements(db: Kysely<Database>, agreementIds: readonly number[]): Promise<number[]> {
  const rows = await db
    .selectFrom('corporate_agreements')
    .select('installation_id')
    .where('id', 'in', agreementIds)
    .execute();
  return rows.map((row) => row.installation_id);
}

/** The id of the agreement of the tenant that has no text yet, or no approval yet, as `arrangeTo` stored it. */
async function agreementOf(db: Kysely<Database>, ids: TenantWorld): Promise<number> {
  const row = await db
    .selectFrom('corporate_agreements')
    .select('id')
    .where('installation_id', '=', ids.installationId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The id of the corporate signature of the tenant. */
async function corporateSignatureOf(db: Kysely<Database>, ids: TenantWorld): Promise<number> {
  const row = await db
    .selectFrom('signatures')
    .select('id')
    .where('installation_id', '=', ids.installationId)
    .where('signer_type', '=', 'corporate')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** A function that takes the tenant and the ids of a resource and answers with the rows of that tenant it read or changed. */
const scoped = (
  options: Pick<ScopedQuery, 'run' | 'arrange' | 'refusal' | 'takesIds' | 'activeOnly'>,
): ScopedQuery => ({
  kind: 'scoped',
  ...options,
});

/** Every function of the modules of corporate signing that runs over a tenant table, by module and name. */
export const E21_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/corporate-agreement-queries.ts': {
    // The signatory is a person and belongs to no tenant: the statement lists their agreements in every tenant, filtered on the key of
    // the session and on nothing the caller supplies. The registry runs it in a world nothing was arranged in, so the run gives the
    // tenant's signer an agreement of their own first.
    ownAgreementRows: {
      kind: 'by_design',
      reason:
        "the agreements of a signed-in person are listed across every tenant (E21-S02); the signatory is a person and belongs to no tenant, and the statement filters on the person's own key, which comes from the session, and on nothing the caller supplies",
      pinnedBy: 'services/corporate-agreement-queries.test.ts',
      run: async (db, _scope, ids) => {
        await corporateTenant(db, ids, ids.signer.githubId);
        const rows = await ownAgreementRows(db, ids.signer.userId, { limit: 10, from: null, agreementId: null });
        return ownersOfAgreements(
          db,
          rows.map((row) => row.id),
        );
      },
      answers: (own, other) => ({ own: [own.installationId], foreign: [other.installationId] }),
    },
    tenantAgreementRows: scoped({
      takesIds: false,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope) => {
        const rows = await tenantAgreementRows(db, scope, { limit: 10, from: null });
        return ownersOfAgreements(
          db,
          rows.map((row) => row.id),
        );
      },
    }),
    insertAgreement: scoped({
      takesIds: true,
      activeOnly: false,
      // The signature of another tenant selects no row for this tenant, which the caller (who has just written the signature) never meets.
      refusal: isNoResult,
      arrange: arrangeTo('signature'),
      run: async (db, scope, ids) =>
        ownersOfAgreements(db, [await insertAgreement(db, scope, await corporateSignatureOf(db, ids))]),
    }),
    insertAgreementText: scoped({
      takesIds: true,
      activeOnly: false,
      refusal: isNoResult,
      arrange: arrangeTo('agreement'),
      run: async (db, scope, ids) => {
        const agreementId = await agreementOf(db, ids);
        await insertAgreementText(db, scope, {
          agreementId,
          companyName: 'Registry Company',
          signatoryTitle: 'Registrar',
        });
        return ownersOfAgreements(db, [agreementId]);
      },
    }),
    insertSignatoryApproval: scoped({
      takesIds: true,
      activeOnly: false,
      refusal: isNoResult,
      arrange: arrangeTo('text'),
      run: async (db, scope, ids) => {
        const agreementId = await agreementOf(db, ids);
        await insertSignatoryApproval(db, scope, {
          agreementId,
          userId: ids.signer.userId,
          githubId: ids.signer.githubId,
          login: ids.signer.login,
        });
        return ownersOfAgreements(db, [agreementId]);
      },
    }),
  },
  'services/corporate-repository-queries.ts': {
    findCorporateSetting: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) => {
        const setting = await findCorporateSetting(db, scope, ids.plain.repositoryId);
        return setting === null ? [] : ownersOfRepositories(db, [ids.plain.repositoryId]);
      },
    }),
    lockCorporateRepository: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) => {
        const locked = await lockCorporateRepository(db, scope, ids.plain.repositoryId);
        return locked === null ? [] : ownersOfRepositories(db, [locked.id]);
      },
    }),
    findCorporateChoice: scoped({
      takesIds: true,
      activeOnly: false,
      arrange: arrangeTo('document'),
      run: async (db, scope, ids) => {
        const { documentId } = await corporateDocumentOf(db, ids);
        const found = await findCorporateChoice(db, scope, ids.plain.repositoryId, documentId);
        return found === null ? [] : ownersOfDocuments(db, [found]);
      },
    }),
    setCorporateDocument: scoped({
      takesIds: true,
      activeOnly: true,
      // A repository of another tenant, or one that is removed, selects no row: the caller holds the lock of a repository it has just read.
      refusal: isNoResult,
      arrange: arrangeTo('document'),
      run: async (db, scope, ids) => {
        const { documentId } = await corporateDocumentOf(db, ids);
        await setCorporateDocument(db, scope, ids.plain.repositoryId, documentId);
        return ownersOfRepositories(db, [ids.plain.repositoryId]);
      },
    }),
  },
};
