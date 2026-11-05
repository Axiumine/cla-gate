// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  CORPORATE_AGREEMENT_PATH,
  CORPORATE_AGREEMENTS_PATH,
  CORPORATE_DOCUMENT_PATH,
  corporateAgreementDetailSchema,
  corporateAgreementPageSchema,
  corporateDocumentResponseSchema,
  INSTALLATION_CORPORATE_AGREEMENTS_PATH,
  REPOSITORY_CORPORATE_DOCUMENT_PATH,
} from '../../../../shared/corporate.ts';
import {
  approvalPageSchema,
  CORPORATE_APPROVAL_PATH,
  CORPORATE_APPROVALS_PATH,
  CORPORATE_CARRY_OVER_PATH,
} from '../../../../shared/corporate-approvals.ts';
import { CORPORATE_AVAILABILITY_PATH, CORPORATE_CLAIMS_PATH } from '../../../../shared/corporate-claims.ts';
import {
  approve,
  personWithId,
  publishCorporateDocument,
  signAgreement,
} from '../../db/corporate-fixture/test-support.ts';
import { installationRowIdSchema } from '../../db/installation-row-id.ts';
import type { Database } from '../../db/schema.ts';
import type { TenantWorld } from '../../db/tenant-fixture/test-support.ts';
import type { CrossTenantCase, IsolationCase } from '../cross-tenant-fixture/test-support.ts';

// The cases of corporate signing (E21-S02) for the route matrix (E11-S06). They sit in a file of their own so that the fixture of the
// matrix stays under the size cap, as the cases of the sign routes do (`cross-tenant-sign-fixture`).

let corporateNumber = 0;

/** A name no document of the world has: the name of a document is unique in its scope, and the matrix asks more than once. */
const freshCorporateName = (): string => {
  corporateNumber += 1;
  return `Matrix corporate CLA ${corporateNumber}`;
};

/**
 * The routes of the corporate flow that act inside one tenant, both for an org admin. The choice of the corporate CLA of a repository
 * names a corporate document of the tenant that the case makes (the world of the matrix stores none; the document has no version, which
 * the choice does not need), and a denied call names the individual document of the tenant instead, so a guard that let it through would
 * answer `422` and not the `404` or `403` the matrix expects.
 */
export const CORPORATE_CROSS_CASES: Readonly<Record<string, CrossTenantCase>> = {
  [`PUT ${REPOSITORY_CORPORATE_DOCUMENT_PATH}`]: {
    endpointClass: 'installation_write',
    bodyFor: async (db, target) => {
      const created = await db
        .insertInto('cla_documents')
        .values({
          installation_id: installationRowIdSchema.parse(target.installationId),
          repository_id: null,
          name: freshCorporateName(),
          kind: 'corporate',
          active_version_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { documentId: created.id };
    },
    request: (target) => ({
      method: 'PUT',
      url: REPOSITORY_CORPORATE_DOCUMENT_PATH.replace(':installationId', String(target.installationId)).replace(
        ':repositoryId',
        String(target.repositoryId),
      ),
      payload: { documentId: target.documentId },
    }),
  },
  [`GET ${INSTALLATION_CORPORATE_AGREEMENTS_PATH}`]: {
    endpointClass: 'installation_read',
    request: (target) => ({
      method: 'GET',
      url: INSTALLATION_CORPORATE_AGREEMENTS_PATH.replace(':installationId', String(target.installationId)),
    }),
  },
};

/** The agreement each tenant's own org admin has in it, by `installations.id`, as {@link arrangeCorporate} stored it. */
const OWN_AGREEMENTS = new Map<number, number>();

/** The signature each approval {@link arrangeCorporate} stored belongs to, by `corporate_approvals.id`: what turns a listed approval into a row whose owner can be read. */
const SIGNATURE_OF_APPROVAL = new Map<number, number>();

/** The databases {@link arrangeCorporate} has been through: the three isolation cases share a world and each asks for the same rows. */
const ARRANGED = new WeakSet<Kysely<Database>>();

/**
 * Gives each tenant its corporate CLA at version 1.0, chosen by the scoped repository (which enforces), and an agreement of its own
 * org admin and one of the org admin of the other tenant, so that the answer to each viewer holds a row of both tenants. The signers
 * are the admins and not `member1`: the erasure case of the matrix counts the rows of `member1` in tenant 1 and expects one.
 */
async function arrangeCorporate(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  if (ARRANGED.has(db)) {
    return;
  }
  ARRANGED.add(db);
  // One tenant after the other: the fixtures write the same tables, and the second signer of a tenant is the first of the other.
  for (const tenant of tenants) {
    const document = await publishCorporateDocument(db, tenant);
    await db
      .updateTable('repositories')
      .set({ enabled: true, corporate_document_id: document.documentId })
      .where('id', '=', tenant.scoped.repositoryId)
      .execute();
    const text = { companyName: `Company of ${tenant.accountLogin}`, signatoryTitle: 'Head of Legal' };
    const own = await signAgreement(db, { tenant, document }, await personWithId(db, tenant.admin.githubId), text);
    OWN_AGREEMENTS.set(tenant.installationId, own.agreementId);
    const admin = tenant.admin;
    for (const subject of [
      { kind: 'user', githubId: admin.githubId, login: admin.login },
      { kind: 'email_domain', domain: `${tenant.accountLogin}.example` },
    ] as const) {
      SIGNATURE_OF_APPROVAL.set(await approve(db, own, subject), own.signatureId);
    }
    for (const other of tenants.filter((candidate) => candidate !== tenant)) {
      await signAgreement(db, { tenant, document }, await personWithId(db, other.admin.githubId), text);
    }
  }
}

/**
 * The corporate CLA in force for a repository is open to any signed-in person and answers with the document and version of the tenant
 * that holds the repository the path names. The path is the only input, so there is no id of another tenant to inject: the request is
 * the same with or without one, and the answer must be the same. The scoped repository of each tenant enforces its corporate CLA, so
 * each viewer is shown the document and version of their own tenant and nothing of the other.
 */
const CORPORATE_DOCUMENT_CASE: IsolationCase = {
  arrange: arrangeCorporate,
  request: (own) => ({
    method: 'GET',
    url: CORPORATE_DOCUMENT_PATH.replace(':githubRepoId', String(own.githubRepoId)),
  }),
  rows: (body) => {
    const answer = corporateDocumentResponseSchema.parse(body);
    return [
      { table: 'cla_documents' as const, id: answer.document.id },
      { table: 'cla_versions' as const, id: answer.versionId },
    ];
  },
  mayShow: (owner, viewer) => owner.installationId === viewer.own.installationId,
};

/**
 * The list of the agreements a person signed names them in every tenant, on purpose, and takes no parameter at all (a query parameter
 * is a `400`), so there is nothing of another tenant to inject. Each viewer signed in both tenants, so the answer to each holds a
 * row of both, and the check is that every row it names is the viewer's own: the other signer's agreement, in either tenant, is never shown.
 */
const CORPORATE_LIST_CASE: IsolationCase = {
  arrange: arrangeCorporate,
  people: ['admin1', 'admin2'],
  request: () => ({ method: 'GET', url: CORPORATE_AGREEMENTS_PATH }),
  rows: (body) =>
    corporateAgreementPageSchema
      .parse(body)
      .items.map((item) => ({ table: 'signatures' as const, id: item.signatureId })),
  mayShow: (owner, viewer) => owner.userId === viewer.userId,
};

/**
 * One agreement of the person of the session. The id in the path is the only input, so there is no id of another tenant to inject:
 * the request is the same with or without one. The viewer asks for the agreement they signed in their own tenant and is shown that
 * one; the agreements that are not theirs, the other tenant's included, are the `404` of the dedicated tests (corporate-tenants.test.ts).
 */
const CORPORATE_ONE_CASE: IsolationCase = {
  arrange: arrangeCorporate,
  people: ['admin1', 'admin2'],
  request: (own) => ({
    method: 'GET',
    url: CORPORATE_AGREEMENT_PATH.replace(':agreementId', String(OWN_AGREEMENTS.get(own.installationId))),
  }),
  rows: (body) => [
    { table: 'signatures' as const, id: corporateAgreementDetailSchema.parse(body).agreement.signatureId },
  ],
  mayShow: (owner, viewer) => owner.userId === viewer.userId && owner.installationId === viewer.own.installationId,
};

/**
 * The approvals of the agreement of the person of the session. The id of the agreement in the path is the only input, so there is no
 * id of another tenant to inject: the request is the same with or without one. Each viewer is shown the approvals of the agreement
 * they signed in their own tenant, and every approval is turned into the signature of its agreement, whose owner is read from the
 * database: nothing of the other tenant, and nothing of the other signer, is in the answer (the 404 of an agreement that is not the
 * caller's is the dedicated test, corporate-approval-tenants.test.ts).
 */
const CORPORATE_APPROVALS_CASE: IsolationCase = {
  arrange: arrangeCorporate,
  people: ['admin1', 'admin2'],
  request: (own) => ({
    method: 'GET',
    url: CORPORATE_APPROVALS_PATH.replace(':agreementId', String(OWN_AGREEMENTS.get(own.installationId))),
  }),
  rows: (body) =>
    // An approval the case did not arrange has no signature: the parse fails and so does the case.
    approvalPageSchema.parse(body).items.map((item) => ({
      table: 'signatures' as const,
      id: z.number().parse(SIGNATURE_OF_APPROVAL.get(item.id)),
    })),
  mayShow: (owner, viewer) => owner.userId === viewer.userId && owner.installationId === viewer.own.installationId,
};

/** The `authenticated` routes of the corporate flow that return tenant data, each with the person's own rows. */
export const CORPORATE_ISOLATION_CASES: Readonly<Record<string, IsolationCase>> = {
  [`GET ${CORPORATE_DOCUMENT_PATH}`]: CORPORATE_DOCUMENT_CASE,
  [`GET ${CORPORATE_AGREEMENTS_PATH}`]: CORPORATE_LIST_CASE,
  [`GET ${CORPORATE_AGREEMENT_PATH}`]: CORPORATE_ONE_CASE,
  [`GET ${CORPORATE_APPROVALS_PATH}`]: CORPORATE_APPROVALS_CASE,
};

/** The `authenticated` routes of the corporate flow that the isolation matrix cannot ask twice. */
export const CORPORATE_NO_TENANT_DATA: Readonly<Record<string, string>> = {
  [`POST ${CORPORATE_AGREEMENTS_PATH}`]:
    'it writes the one agreement of the caller for the tenant the body names and answers with the ids of that agreement; a second call is the 409 agreement_exists, so the matrix, which repeats every call, cannot hold it, and its cross-tenant cases are corporate-sign-rules.test.ts and corporate-tenants.test.ts (E21-S02)',
  [`POST ${CORPORATE_APPROVALS_PATH}`]:
    'it adds one approval to the agreement of the caller and answers with that approval; a second call is the 409 approval_exists, so the matrix, which repeats every call, cannot hold it, and its cross-tenant cases are corporate-approval-tenants.test.ts and corporate-approval-add-rules.test.ts (E21-S03)',
  [`DELETE ${CORPORATE_APPROVAL_PATH}`]:
    'it revokes one approval of the agreement of the caller and answers with that approval; a second call is the 409 already_revoked, so the matrix, which repeats every call, cannot hold it, and its cross-tenant cases are corporate-approval-tenants.test.ts and corporate-approval-revoke.test.ts (E21-S03)',
  [`POST ${CORPORATE_CARRY_OVER_PATH}`]:
    'it copies approvals between two agreements of the caller and answers with two counts, which a second call changes (everything is skipped), and the matrix, which repeats every call, cannot hold it; its cross-tenant cases are corporate-approval-tenants.test.ts and corporate-approval-carry-over.test.ts (E21-S03)',
  [`GET ${CORPORATE_AVAILABILITY_PATH}`]:
    'it answers one boolean for the repository the path names, true only when a corporate document and a valid agreement exist, and no row of any table, so there is no tenant row to show another tenant; its cross-tenant cases are corporate-claim-availability.test.ts (E21-S04)',
  [`POST ${CORPORATE_CLAIMS_PATH}`]:
    'it writes one derived approval for the caller in the tenant of the repository the path names and answers with a status word and no row; a second call is the 200 already_covered, so the matrix, which repeats every call, cannot hold it, and its cross-tenant cases are corporate-claim-rules.test.ts (E21-S04)',
};
